package org.dromara.neutrinoproxy.client.core;

import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.handler.codec.DecoderException;
import lombok.extern.slf4j.Slf4j;
import org.dromara.neutrinoproxy.client.util.ProxyUtil;
import org.dromara.neutrinoproxy.core.Constants;
import org.dromara.neutrinoproxy.core.ProxyMessage;
import io.netty.buffer.ByteBuf;

import java.io.IOException;
import java.net.SocketException;

/**
 * 处理与被代理客户端的数据传输
 * @author: aoshiguchen
 * @date: 2022/6/16
 */
@Slf4j
public class RealServerChannelHandler extends SimpleChannelInboundHandler<ByteBuf> {


    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf buf) throws Exception {
        Channel realServerChannel = ctx.channel();
        Channel proxyChannel = realServerChannel.attr(Constants.NEXT_CHANNEL).get();
        if (null == proxyChannel) {
            // 代理客户端连接断开
            ctx.channel().close();
        } else {

            if (proxyChannel.isWritable()) {
                if (!realServerChannel.config().isAutoRead()) {
                    realServerChannel.config().setAutoRead(true);
                }
            } else {
                if (realServerChannel.config().isAutoRead()) {
                    realServerChannel.config().setAutoRead(false);
                }
            }

            byte[] bytes = new byte[buf.readableBytes()];
            buf.readBytes(bytes);
            String visitorId = ProxyUtil.getVisitorIdByRealServerChannel(realServerChannel);
            proxyChannel.writeAndFlush(ProxyMessage.buildTransferMessage(visitorId, bytes));
        }
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {
        super.channelActive(ctx);
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
        Channel realServerChannel = ctx.channel();
        String visitorId = ProxyUtil.getVisitorIdByRealServerChannel(realServerChannel);
        ProxyUtil.removeRealServerChannel(visitorId);
        Channel proxyChannel = realServerChannel.attr(Constants.NEXT_CHANNEL).get();
        if (proxyChannel != null && proxyChannel.isActive()) {
            // channel.writeAndFlush(ProxyMessage.buildDisconnectMessage(visitorId));
            proxyChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
        }

        super.channelInactive(ctx);
    }

    @Override
    public void channelWritabilityChanged(ChannelHandlerContext ctx) throws Exception {
        Channel realServerChannel = ctx.channel();
        Channel proxyChannel = realServerChannel.attr(Constants.NEXT_CHANNEL).get();
        if (proxyChannel != null) {
            proxyChannel.config().setOption(ChannelOption.AUTO_READ, realServerChannel.isWritable());
        }

        super.channelWritabilityChanged(ctx);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        // 对于网络IO异常（致命异常），关闭channel以防止资源泄漏
        // 对于其他异常（可能是可恢复的业务异常），只记录日志
        if (cause instanceof IOException) {
            // IOException及其子类（包括SocketException）都是致命的网络异常
            if (cause instanceof SocketException && cause.getMessage() != null && cause.getMessage().contains("Connection reset")) {
                // Connection reset是常见的客户端断开，使用debug级别
                log.debug("[Real Server Channel] Client connection reset: {}", cause.getMessage());
            } else {
                log.error("[Real Server Channel] IO Error", cause);
            }
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else if(cause instanceof DecoderException) {
            // 协议解析错误，为防止数据污染，立即关闭
            log.debug("[Real Server Channel] decoder error: {}", cause.getMessage());
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else {
            // 其他异常只记录日志，不关闭channel，让Netty自己处理
            log.error("[Real Server Channel] error", cause);
        }
    }
}
