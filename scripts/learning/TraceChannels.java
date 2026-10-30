import com.sun.jdi.Bootstrap;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.event.MethodEntryEvent;
import com.sun.jdi.request.EventRequest;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** Teaching debugger: observe real project callbacks without changing application classes. */
class TraceChannels {
    record Hit(String role, String method, String thread, String handler) {}
    static final List<Hit> hits = new CopyOnWriteArrayList<>();
    static final List<String> errors = new CopyOnWriteArrayList<>();
    static final Set<Hit> seen = ConcurrentHashMap.newKeySet();

    static void watch(String role, int port, String[] classes, CountDownLatch ready, AtomicBoolean stop) {
        VirtualMachine vm = null;
        boolean announced = false;
        try {
            var connector = Bootstrap.virtualMachineManager().attachingConnectors().stream()
                .filter(item -> item.name().equals("com.sun.jdi.SocketAttach")).findFirst().orElseThrow();
            var arguments = connector.defaultArguments();
            arguments.get("hostname").setValue("127.0.0.1");
            arguments.get("port").setValue(Integer.toString(port));
            arguments.get("timeout").setValue("10000");
            vm = connector.attach(arguments);
            for (String name : classes) {
                var request = vm.eventRequestManager().createMethodEntryRequest();
                request.addClassFilter(name);
                request.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                request.enable();
            }
            ready.countDown();
            announced = true;
            while (!stop.get()) {
                var events = vm.eventQueue().remove(200);
                if (events == null) continue;
                try {
                    for (var event : events) {
                        if (!(event instanceof MethodEntryEvent entry)) continue;
                        String method = entry.method().name();
                        if (!Set.of("channelActive", "channelRead0").contains(method)) continue;
                        // Each observed handler is created per Channel by this project.
                        // Reading thisObject avoids local-variable slot differences across JDK builds.
                        var handler = entry.thread().frame(0).thisObject();
                        if (handler == null) continue;
                        Hit hit = new Hit(role, method, entry.thread().name(), Long.toString(handler.uniqueID()));
                        if (seen.add(hit)) hits.add(hit);
                    }
                } finally {
                    events.resume();
                }
            }
        } catch (Exception error) {
            errors.add(role + ": " + error.getClass().getSimpleName() + ": " + error.getMessage());
        } finally {
            if (!announced) ready.countDown();
            if (vm != null) {
                try { vm.resume(); vm.dispose(); } catch (RuntimeException ignored) {}
            }
        }
    }

    static void echo(int port, int index) throws Exception {
        byte[] payload = ("reader-" + index + "|hello-neutrino").getBytes(StandardCharsets.UTF_8);
        try (Socket connection = new Socket()) {
            connection.connect(new InetSocketAddress("127.0.0.1", port), 3000);
            connection.setSoTimeout(10000);
            connection.getOutputStream().write(payload);
            byte[] reply = connection.getInputStream().readNBytes(payload.length);
            if (!Arrays.equals(payload, reply)) throw new AssertionError("Echo differs for reader " + index);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 3) throw new IllegalArgumentException("Use: TraceChannels.java SERVER_DEBUG_PORT CLIENT_DEBUG_PORT MAPPING_PORT");
        int server = Integer.parseInt(args[0]), client = Integer.parseInt(args[1]), mapping = Integer.parseInt(args[2]);
        for (int port : new int[]{server, client, mapping}) {
            if (port < 1 || port > 65535) throw new IllegalArgumentException("Invalid loopback port");
        }
        var stop = new AtomicBoolean(false);
        var ready = new CountDownLatch(2);
        var watchers = Executors.newFixedThreadPool(2);
        var readers = Executors.newFixedThreadPool(2);
        try {
            watchers.submit(() -> watch("server", server, new String[]{
                "org.dromara.neutrinoproxy.server.proxy.core.TcpVisitorChannelHandler"}, ready, stop));
            watchers.submit(() -> watch("client", client, new String[]{
                "org.dromara.neutrinoproxy.client.core.RealServerChannelHandler"}, ready, stop));
            if (!ready.await(15, TimeUnit.SECONDS) || !errors.isEmpty()) throw new IllegalStateException("Cannot attach: " + errors);
            var transfers = new ArrayList<java.util.concurrent.Future<?>>();
            for (int index = 1; index <= 2; index++) {
                final int number = index;
                transfers.add(readers.submit(() -> { echo(mapping, number); return null; }));
            }
            for (var transfer : transfers) transfer.get(15, TimeUnit.SECONDS);
        } finally {
            stop.set(true);
            readers.shutdownNow();
            watchers.shutdown();
            if (!watchers.awaitTermination(10, TimeUnit.SECONDS)) watchers.shutdownNow();
        }
        if (!errors.isEmpty()) throw new IllegalStateException("Capture failed: " + errors);
        for (Hit hit : hits) System.out.printf("%s | %s | thread=%s | handlerObject=%s%n", hit.role, hit.method, hit.thread, hit.handler);
        long serverChannels = hits.stream().filter(hit -> hit.role.equals("server") && hit.method.equals("channelActive"))
            .map(Hit::handler).distinct().count();
        long serverThreads = hits.stream().filter(hit -> hit.role.equals("server") && hit.method.equals("channelActive"))
            .map(Hit::thread).distinct().count();
        boolean clientRead = hits.stream().anyMatch(hit -> hit.role.equals("client") && hit.method.equals("channelRead0"));
        if (serverChannels != 2 || serverThreads != 1 || !clientRead) throw new AssertionError("Expected two visitor channels on the lab's single worker and a real-target read");
        System.out.println("TRACE_PASS visitors=2 serverWorkerThreads=1 clientResponseObserved=true");
    }
}
