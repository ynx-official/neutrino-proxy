import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.embedded.EmbeddedChannel;
import org.dromara.neutrinoproxy.core.ProxyMessage;
import org.dromara.neutrinoproxy.core.ProxyMessageDecoder;
import org.dromara.neutrinoproxy.core.ProxyMessageEncoder;
import org.dromara.neutrinoproxy.core.dispatcher.DefaultDispatcher;
import org.dromara.neutrinoproxy.core.dispatcher.Handler;
import org.dromara.neutrinoproxy.core.dispatcher.Match;
import org.dromara.neutrinoproxy.server.base.rest.SystemContext;
import org.dromara.neutrinoproxy.server.base.rest.SystemContextHolder;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** Teaching harness: directly calls project classes without booting the application or a database. */
class FoundationsLab {
    private static final List<String> checks = new ArrayList<>();
    private static final List<String> observations = new ArrayList<>();

    @Match(type = "hit")
    public static class Hit implements Handler<String, ProxyMessage> {
        int calls;
        public void handle(String context, ProxyMessage data) { calls++; }
    }

    private static void check(String name, boolean passed) {
        if (!passed) throw new AssertionError(name);
        checks.add(name);
    }

    private static void dispatcher() {
        Hit first = new Hit();
        Hit duplicate = new Hit();
        var dispatcher = new DefaultDispatcher<String, ProxyMessage>("learning", List.of(first, duplicate), ProxyMessage::getInfo);
        dispatcher.dispatch("local", ProxyMessage.create().setInfo("hit"));
        check("dispatcher_known_type", first.calls == 1);
        check("dispatcher_duplicate_keeps_first", duplicate.calls == 0);
        dispatcher.dispatch("local", ProxyMessage.create().setInfo("unknown"));
        check("dispatcher_unknown_type_ignored", first.calls == 1 && duplicate.calls == 0);
    }

    private static void compoundOperations() throws Exception {
        Map<String, Integer> counter = new ConcurrentHashMap<>();
        counter.put("count", 0);
        CountDownLatch read = new CountDownLatch(2);
        CountDownLatch write = new CountDownLatch(1);
        Runnable nonAtomic = () -> {
            int previous = counter.get("count");
            read.countDown();
            try {
                if (!write.await(5, TimeUnit.SECONDS)) throw new AssertionError("write barrier");
            } catch (InterruptedException error) {
                throw new RuntimeException(error);
            }
            counter.put("count", previous + 1);
        };
        Thread a = new Thread(nonAtomic);
        Thread b = new Thread(nonAtomic);
        a.start(); b.start();
        if (!read.await(5, TimeUnit.SECONDS)) throw new AssertionError("read barrier");
        write.countDown();
        a.join(5000); b.join(5000);
        check("compound_get_put_loses_update", !a.isAlive() && !b.isAlive() && counter.get("count") == 1);
        counter.put("count", 0);
        Runnable atomic = () -> {
            for (int i = 0; i < 1000; i++) counter.compute("count", (key, value) -> value + 1);
        };
        a = new Thread(atomic); b = new Thread(atomic);
        a.start(); b.start(); a.join(5000); b.join(5000);
        check("compute_preserves_updates", !a.isAlive() && !b.isAlive() && counter.get("count") == 2000);
    }

    private static void bytesAndFrames() {
        check("utf8_character_is_three_bytes", "中".getBytes(StandardCharsets.UTF_8).length == 3);
        EmbeddedChannel encoder = new EmbeddedChannel(new ProxyMessageEncoder());
        EmbeddedChannel decoder = new EmbeddedChannel(new ProxyMessageDecoder(2 * 1024 * 1024, 0, 4, 0, 0));
        try {
            byte[] data = {0, 1, 127, (byte) 255};
            encoder.writeOutbound(ProxyMessage.create().setType((byte) 5).setSerialNumber(17).setInfo("你好").setData(data));
            ByteBuf frame = encoder.readOutbound();
            byte[] bytes = new byte[frame.readableBytes()];
            frame.readBytes(bytes);
            frame.release();
            check("encoded_frame_is_27_bytes", bytes.length == 27);
            decoder.writeInbound(Unpooled.wrappedBuffer(bytes, 0, 2));
            check("partial_frame_waits", decoder.readInbound() == null);
            decoder.writeInbound(Unpooled.wrappedBuffer(bytes, 2, bytes.length - 2));
            ProxyMessage decoded = decoder.readInbound();
            check("project_codec_roundtrip", decoded.getSerialNumber() == 17 && decoded.getInfo().equals("你好") && Arrays.equals(data, decoded.getData()));
        } finally {
            encoder.finishAndReleaseAll();
            decoder.finishAndReleaseAll();
        }
        ByteBuf parent = Unpooled.buffer(8).writeLong(1);
        ByteBuf retained = parent.retainedSlice(0, 4);
        check("retained_slice_shares_count", parent.refCnt() == 2 && retained.refCnt() == 2);
        retained.release();
        check("release_returns_count_to_one", parent.refCnt() == 1);
        parent.release();
        check("last_release_reaches_zero", parent.refCnt() == 0);
    }

    private static void requestContext() throws Exception {
        var executor = Executors.newSingleThreadExecutor();
        SystemContext main = new SystemContext();
        SystemContextHolder.set(main);
        try {
            check("threadlocal_not_automatically_inherited", executor.submit(() -> SystemContextHolder.getContext() == null).get(5, TimeUnit.SECONDS));
            executor.submit(() -> SystemContextHolder.set(new SystemContext())).get(5, TimeUnit.SECONDS);
            check("pooled_thread_keeps_uncleared_context", executor.submit(() -> SystemContextHolder.getContext() != null).get(5, TimeUnit.SECONDS));
            executor.submit(SystemContextHolder::remove).get(5, TimeUnit.SECONDS);
            check("remove_clears_reused_thread", executor.submit(() -> SystemContextHolder.getContext() == null).get(5, TimeUnit.SECONDS));
            check("main_context_is_separate", SystemContextHolder.getContext() == main);
        } finally {
            SystemContextHolder.remove();
            executor.shutdownNow();
        }
    }

    private static byte[] encode(ProxyMessage message) {
        EmbeddedChannel channel = new EmbeddedChannel(new ProxyMessageEncoder());
        try {
            channel.writeOutbound(message);
            ByteBuf frame = channel.readOutbound();
            try {
                byte[] bytes = new byte[frame.readableBytes()];
                frame.readBytes(bytes);
                return bytes;
            } finally {
                frame.release();
            }
        } finally {
            channel.finishAndReleaseAll();
        }
    }

    private static void protocolBoundaries() {
        byte[] empty = encode(ProxyMessage.buildHeartbeatMessage());
        check("empty_frame_is_17_bytes", empty.length == 17);
        ByteBuf view = Unpooled.wrappedBuffer(empty);
        try {
            check("outer_length_excludes_its_own_four_bytes", view.readInt() == 13);
        } finally {
            view.release();
        }
        byte[] binary = new byte[256];
        for (int i = 0; i < binary.length; i++) binary[i] = (byte) i;
        byte[] transfer = encode(ProxyMessage.buildTransferMessage("local-visitor", binary));
        EmbeddedChannel joined = new EmbeddedChannel(new ProxyMessageDecoder(2048, 0, 4, 0, 0));
        try {
            ByteBuf combined = Unpooled.buffer(empty.length + transfer.length).writeBytes(empty).writeBytes(transfer);
            joined.writeInbound(combined);
            ProxyMessage first = joined.readInbound();
            ProxyMessage second = joined.readInbound();
            check("concatenated_frames_decode_in_order", first.getType() == ProxyMessage.TYPE_HEARTBEAT && second.getType() == ProxyMessage.TYPE_TRANSFER && joined.readInbound() == null);
            check("null_info_decodes_as_empty_string", first.getInfo().equals(""));
            check("all_binary_byte_values_roundtrip", Arrays.equals(binary, second.getData()));
        } finally {
            joined.finishAndReleaseAll();
        }
        EmbeddedChannel fragmented = new EmbeddedChannel(new ProxyMessageDecoder(2048, 0, 4, 0, 0));
        try {
            for (int i = 0; i < transfer.length - 1; i++) {
                fragmented.writeInbound(Unpooled.wrappedBuffer(new byte[]{transfer[i]}));
                if (fragmented.readInbound() != null) throw new AssertionError("early frame");
            }
            fragmented.writeInbound(Unpooled.wrappedBuffer(new byte[]{transfer[transfer.length - 1]}));
            ProxyMessage decoded = fragmented.readInbound();
            check("one_byte_fragments_wait_for_complete_frame", Arrays.equals(binary, decoded.getData()));
        } finally {
            fragmented.finishAndReleaseAll();
        }
        malformedInfo(-1);
        malformedInfo(1024);
        EmbeddedChannel oversized = new EmbeddedChannel(new ProxyMessageDecoder(256, 0, 4, 0, 0));
        try {
            boolean rejected = false;
            try {
                oversized.writeInbound(Unpooled.buffer(4).writeInt(257));
            } catch (io.netty.handler.codec.TooLongFrameException expected) {
                rejected = true;
            }
            check("oversized_frame_rejected_at_length_header", rejected);
        } finally {
            oversized.finishAndReleaseAll();
        }
    }

    private static void malformedInfo(int infoLength) {
        EmbeddedChannel channel = new EmbeddedChannel(new ProxyMessageDecoder(2048, 0, 4, 0, 0));
        // Keep one diagnostic reference so its count can be inspected after the channel cleans up.
        ByteBuf input = Unpooled.buffer(17).writeInt(13).writeByte(5).writeLong(0).writeInt(infoLength);
        input.retain();
        try {
            boolean rejected = false;
            String cause = "none";
            try {
                channel.writeInbound(input);
            } catch (io.netty.handler.codec.DecoderException error) {
                rejected = true;
                cause = error.getCause() == null ? error.getClass().getSimpleName() : error.getCause().getClass().getSimpleName();
            }
            check("malformed_info_" + infoLength + "_throws", rejected);
            channel.finishAndReleaseAll();
            observations.add("infoLength=" + infoLength + ": cause=" + cause + ", refCnt after channel cleanup=" + input.refCnt() + ", diagnostic reference expected=1; lab manually releases remainder");
        } finally {
            channel.finishAndReleaseAll();
            while (input.refCnt() > 0) input.release();
        }
    }

    public static void main(String[] args) throws Exception {
        dispatcher();
        compoundOperations();
        bytesAndFrames();
        requestContext();
        protocolBoundaries();
        System.out.println("NP_LESSON_RESULT={\"checks\":[" + checks.stream().map(name -> "\"" + name + "\"").collect(java.util.stream.Collectors.joining(",")) + "],\"observations\":[" + observations.stream().map(value -> "\"" + value + "\"").collect(java.util.stream.Collectors.joining(",")) + "]}");
    }
}
