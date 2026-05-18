package org.dromara.neutrinoproxy.client.core;

import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.socket.DatagramPacket;
import io.netty.handler.codec.DecoderException;
import lombok.extern.slf4j.Slf4j;
import org.dromara.neutrinoproxy.client.constant.Constants;
import org.dromara.neutrinoproxy.client.util.UdpChannelBindInfo;
import org.dromara.neutrinoproxy.core.ProxyMessage;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.util.Date;

/**
 * @author: aoshiguchen
 * @date: 2023/9/21
 */
@Slf4j
public class UdpRealServerHandler extends SimpleChannelInboundHandler<DatagramPacket> {

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, DatagramPacket datagramPacket) throws Exception {
        log.debug("chid---<:{} port:{}", ctx.channel().id().asLongText(), ((InetSocketAddress)ctx.channel().localAddress()).getPort());
        UdpChannelBindInfo udpChannelBindInfo = ctx.channel().attr(Constants.UDP_CHANNEL_BIND_KEY).get();
        if (null != udpChannelBindInfo) {
            byte[] bytes = new byte[datagramPacket.content().readableBytes()];
            datagramPacket.content().readBytes(bytes);

            udpChannelBindInfo.getTunnelChannel().writeAndFlush(ProxyMessage.buildUdpTransferMessage(new ProxyMessage.UdpBaseInfo()
                            .setVisitorId(udpChannelBindInfo.getVisitorId())
                            .setVisitorIp(udpChannelBindInfo.getVisitorIp())
                            .setVisitorPort(udpChannelBindInfo.getVisitorPort())
                            .setServerPort(udpChannelBindInfo.getServerPort())
                            .setTargetIp(udpChannelBindInfo.getTargetIp())
                            .setTargetPort(udpChannelBindInfo.getTargetPort()))
                    .setData(bytes)
            );

            udpChannelBindInfo.getLockChannel().setResponseCount(udpChannelBindInfo.getLockChannel().getResponseCount() + 1);
            udpChannelBindInfo.getLockChannel().setLastActiveTime(new Date());
        }
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        // 对于网络IO异常（致命异常），关闭channel以防止资源泄漏
        // 对于其他异常（可能是可恢复的业务异常），只记录日志
        if (cause instanceof IOException) {
            // IOException及其子类（包括SocketException）都是致命的网络异常
            if (cause instanceof SocketException && cause.getMessage() != null && cause.getMessage().contains("Connection reset")) {
                // Connection reset是常见的客户端断开，使用debug级别
                log.debug("[UDP RealServer Channel] Client connection reset: {}", cause.getMessage());
            } else {
                log.error("[UDP RealServer Channel] IO Error", cause);
            }
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else if(cause instanceof DecoderException) {
            // 协议解析错误，为防止数据污染，立即关闭
            log.debug("[UDP RealServer Channel] decoder error: {}", cause.getMessage());
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else {
            // 其他异常只记录日志，不关闭channel，让Netty自己处理
            log.error("[UDP RealServer Channel] error", cause);
        }
    }

//    @Override
//    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
//        // 数据传输连接
//        Channel realServerChannel = ctx.channel().attr(org.dromara.neutrinoproxy.core.Constants.NEXT_CHANNEL).get();
//        if (realServerChannel != null && realServerChannel.isActive()) {
//            // realServerChannel.close();
//            realServerChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
//        }
//
//        ProxyUtil.removeUdpProxyChanel(ctx.channel());
//        super.channelInactive(ctx);
//    }
}
