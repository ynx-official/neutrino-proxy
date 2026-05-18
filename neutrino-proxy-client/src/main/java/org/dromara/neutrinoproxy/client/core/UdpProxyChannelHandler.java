package org.dromara.neutrinoproxy.client.core;

import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.handler.codec.DecoderException;
import io.netty.handler.timeout.IdleStateEvent;
import lombok.extern.slf4j.Slf4j;
import org.dromara.neutrinoproxy.client.util.ProxyUtil;
import org.dromara.neutrinoproxy.core.Constants;
import org.dromara.neutrinoproxy.core.ProxyMessage;
import org.dromara.neutrinoproxy.core.dispatcher.Dispatcher;
import org.noear.solon.Solon;

import java.io.IOException;
import java.net.SocketException;

/**
 * 处理与服务端之间的数据传输
 * @author: aoshiguchen
 * @date: 2022/6/16
 */
@Slf4j
public class UdpProxyChannelHandler extends SimpleChannelInboundHandler<ProxyMessage> {


    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ProxyMessage proxyMessage) throws Exception {
        if (ProxyMessage.TYPE_HEARTBEAT != proxyMessage.getType()) {
            log.debug("[UDP Proxy Channel]Client ProxyChannel recieved proxy message, type is {}", proxyMessage.getType());
        }
        Solon.context().getBean(Dispatcher.class).dispatch(ctx, proxyMessage);
    }

    @Override
    public void channelWritabilityChanged(ChannelHandlerContext ctx) throws Exception {
        Channel realServerChannel = ctx.channel().attr(Constants.NEXT_CHANNEL).get();
        if (realServerChannel != null) {
            realServerChannel.config().setOption(ChannelOption.AUTO_READ, ctx.channel().isWritable());
        }

        super.channelWritabilityChanged(ctx);
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
        // 数据传输连接
        Channel realServerChannel = ctx.channel().attr(Constants.NEXT_CHANNEL).get();
        if (realServerChannel != null && realServerChannel.isActive()) {
            // realServerChannel.close();
            realServerChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
        }

        ProxyUtil.returnUdpProxyChanel(ctx.channel());
        ProxyUtil.removeUdpProxyChanel(ctx.channel());
        super.channelInactive(ctx);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        // 对于网络IO异常（致命异常），关闭channel以防止资源泄漏
        // 对于其他异常（可能是可恢复的业务异常），只记录日志
        if (cause instanceof IOException) {
            // IOException及其子类（包括SocketException）都是致命的网络异常
            if (cause instanceof SocketException && cause.getMessage() != null && cause.getMessage().contains("Connection reset")) {
                // Connection reset是常见的客户端断开，使用debug级别
                log.debug("[UDP Proxy Channel] Client connection reset: {}", cause.getMessage());
            } else {
                log.error("[UDP Proxy Channel] IO Error", cause);
            }
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else if(cause instanceof DecoderException) {
            // 协议解析错误，为防止数据污染，立即关闭
            log.debug("[UDP Proxy Channel] decoder error: {}", cause.getMessage());
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else {
            // 其他异常只记录日志，不关闭channel，让Netty自己处理
            log.error("[UDP Proxy Channel] error", cause);
        }
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) throws Exception {
        if(evt instanceof IdleStateEvent) {
            IdleStateEvent event = (IdleStateEvent)evt;
            switch (event.state()) {
                case READER_IDLE:
                    if (ctx.channel().isWritable()) {
                        // 读超时，断开连接
                        log.info("[UDP Proxy Channel]Read timeout");
                        ctx.channel().close();
                    }
                    break;
                case WRITER_IDLE:
                    ctx.channel().writeAndFlush(ProxyMessage.buildHeartbeatMessage());
                    break;
                case ALL_IDLE:
                    // log.debug("[UDP Proxy Channel]ReadWrite timeout");
                    // ctx.close();
                    break;
            }
        }
    }
}
