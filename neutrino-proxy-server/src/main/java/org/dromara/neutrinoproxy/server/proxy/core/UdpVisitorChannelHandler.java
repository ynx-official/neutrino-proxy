package org.dromara.neutrinoproxy.server.proxy.core;

import cn.hutool.core.util.StrUtil;
import io.netty.channel.Channel;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelOption;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.channel.socket.DatagramPacket;
import lombok.extern.slf4j.Slf4j;
import org.dromara.neutrinoproxy.core.Constants;
import org.dromara.neutrinoproxy.core.ProxyMessage;
import org.dromara.neutrinoproxy.server.constant.NetworkProtocolEnum;
import org.dromara.neutrinoproxy.server.proxy.domain.VisitorChannelAttachInfo;
import org.dromara.neutrinoproxy.server.service.FlowReportService;
import org.dromara.neutrinoproxy.server.util.ProxyUtil;
import org.noear.solon.Solon;

import java.net.InetSocketAddress;

/**
 * @author: aoshiguchen
 * @date: 2023/9/16
 */
@Slf4j
public class UdpVisitorChannelHandler extends SimpleChannelInboundHandler<DatagramPacket> {

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, DatagramPacket datagramPacket) throws Exception {
        Channel visitorChannel = ctx.channel();
        InetSocketAddress sa = (InetSocketAddress) visitorChannel.localAddress();

        byte[] bytes = new byte[datagramPacket.content().readableBytes()];
        datagramPacket.content().readBytes(bytes);
        datagramPacket.content().resetReaderIndex();
        Constants.ProxyAttachment proxyAttachment = new Constants.ProxyAttachment(bytes, (channel, buf) -> {
            String visitorId = ProxyUtil.getVisitorIdBySocketAddress(datagramPacket.sender());
            if (StrUtil.isBlank(visitorId)) {
                return;
            }
            Channel proxyChannel = ProxyUtil.getTunnelChannelByVisitorId(visitorId);
//            Channel proxyChannel = channel.attr(Constants.NEXT_CHANNEL).get();

            if (null == proxyChannel) {
//                // 该端口还没有代理客户端
//                ctx.channel().close();
                return;
            }

            proxyChannel.attr(Constants.SENDER).set(datagramPacket.sender());
            String targetIp = proxyChannel.attr(Constants.TARGET_IP).get();
            int targetPort = proxyChannel.attr(Constants.TARGET_PORT).get();
            Integer proxyResponses = proxyChannel.attr(Constants.PROXY_RESPONSES).get();
            Long proxyTimeoutMs = proxyChannel.attr(Constants.PROXY_TIMEOUT_MS).get();

            // 转发代理数据
            proxyChannel.writeAndFlush(ProxyMessage.buildUdpTransferMessage(new ProxyMessage.UdpBaseInfo()
                    .setVisitorId(visitorId)
                    .setVisitorIp(datagramPacket.sender().getAddress().getHostAddress())
                    .setVisitorPort(datagramPacket.sender().getPort())
                    .setTargetIp(targetIp)
                    .setTargetPort(targetPort)
                    .setProxyTimeoutMs(proxyTimeoutMs)
                    .setProxyResponses(proxyResponses)
            ).setData(bytes));

            // 增加流量计数
            VisitorChannelAttachInfo visitorChannelAttachInfo = ProxyUtil.getAttachInfo(channel);
            Solon.context().getBean(FlowReportService.class).addWriteByte(visitorChannelAttachInfo.getLicenseId(), bytes.length);
        });

        String visitorId = ProxyUtil.getVisitorIdBySocketAddress(datagramPacket.sender());
        Channel proxyChannel = ProxyUtil.getTunnelChannelByVisitorId(visitorId);
        if (StrUtil.isNotBlank(visitorId) && null != proxyChannel && proxyChannel.isActive()) {
            // UDP代理隧道已就绪，直接转发
            proxyAttachment.execute(ctx.channel());
            return;
        }

        Channel cmdChannel = ProxyUtil.getCmdChannelByServerPort(sa.getPort());

        // 没有指令通道，直接结束
        if (null == cmdChannel) {
            // 该端口还没有代理客户端
//            ctx.channel().close();
            return;
        }

        // 根据代理服务端端口，获取被代理客户端局域网连接信息
        String lanInfo = ProxyUtil.getClientLanInfoByServerPort(sa.getPort());
        if (StrUtil.isEmpty(lanInfo)) {
            ctx.channel().close();
            return;
        }

        String[] targetInfo = lanInfo.split(":");
        String targetIp = targetInfo[0];
        int targetPort = Integer.parseInt(targetInfo[1]);

//        // 用户连接到代理服务器时，设置用户连接不可读，等待代理后端服务器连接成功后再改变为可读状态
//        visitorChannel.config().setOption(ChannelOption.AUTO_READ, false);

        // UDP场景下，一个visitorId并不对应一个visitorChannel，所有visitor共用一个visitorChannel
        visitorId = ProxyUtil.newVisitorId();
        // 设置udp发送方的地址
        ProxyUtil.setVisitorIdToSocketAddressMap(visitorId, datagramPacket.sender());
        // 此处需要和tcp分开
        ProxyUtil.addVisitorChannelToCmdChannel(NetworkProtocolEnum.UDP, cmdChannel, visitorId, visitorChannel, sa.getPort());
        ProxyUtil.addProxyConnectAttachment(visitorId, proxyAttachment);
        cmdChannel.writeAndFlush(ProxyMessage.buildUdpConnectMessage(new ProxyMessage.UdpBaseInfo()
                .setVisitorId(visitorId)
                .setServerPort(sa.getPort())
                .setTargetIp(targetIp)
                .setTargetPort(targetPort)
                // connect消息没有传超时时间、响应数量，导致客户端日志输出的超时时间、响应数量都是0
        ));
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {
        super.channelActive(ctx);
    }

//    @Override
//    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
//        // 对于网络IO异常（致命异常），关闭channel以防止资源泄漏
//        // 对于其他异常（可能是可恢复的业务异常），只记录日志
//        if (cause instanceof IOException) {
//            // IOException及其子类（包括SocketException）都是致命的网络异常
//            if (cause instanceof SocketException && cause.getMessage() != null && cause.getMessage().contains("Connection reset")) {
//                // Connection reset是常见的客户端断开，使用debug级别
//                log.debug("[UDP Visitor Channel] Connection reset: {}", cause.getMessage());
//            } else {
//                log.error("[UDP Visitor Channel] IO error", cause);
//            }
//            if (ctx.channel().isActive()) {
//                ctx.channel().close();
//            }
//        } else if(cause instanceof DecoderException) {
//            // 协议解析错误，为防止数据污染，立即关闭
//            log.debug("[UDP Visitor Channel] decoder error: {}", cause.getMessage());
//            if (ctx.channel().isActive()) {
//                ctx.channel().close();
//            }
//        } else {
//            // 其他异常只记录日志，不关闭channel，让Netty自己处理
//            log.error("[UDP Visitor Channel] error", cause);
//        }
//    }

    @Override
    public void channelWritabilityChanged(ChannelHandlerContext ctx) throws Exception {

        // 通知代理客户端
        Channel visitorChannel = ctx.channel();
        InetSocketAddress sa = (InetSocketAddress) visitorChannel.localAddress();
        Channel cmdChannel = ProxyUtil.getCmdChannelByServerPort(sa.getPort());

        if (null == cmdChannel) {
            // 该端口还没有代理客户端
            ctx.channel().close();
        }
        else {
            Channel proxyChannel = visitorChannel.attr(Constants.NEXT_CHANNEL).get();
            if (null != proxyChannel) {
                proxyChannel.config().setOption(ChannelOption.AUTO_READ, visitorChannel.isWritable());
            }
        }

        super.channelWritabilityChanged(ctx);
    }
}
