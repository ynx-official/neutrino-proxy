package org.dromara.neutrinoproxy.server.proxy.core;

import cn.hutool.core.util.StrUtil;
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.handler.codec.DecoderException;
import lombok.extern.slf4j.Slf4j;
import org.dromara.neutrinoproxy.core.Constants;
import org.dromara.neutrinoproxy.core.ProxyMessage;
import org.dromara.neutrinoproxy.server.constant.NetworkProtocolEnum;
import org.dromara.neutrinoproxy.server.proxy.domain.VisitorChannelAttachInfo;
import org.dromara.neutrinoproxy.server.service.FlowReportService;
import org.dromara.neutrinoproxy.server.util.ProxyUtil;
import org.noear.solon.Solon;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.SocketException;

/**
 *
 * @author: aoshiguchen
 * @date: 2022/6/16
 */
@Slf4j
public class TcpVisitorChannelHandler extends SimpleChannelInboundHandler<ByteBuf> {

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        // 对于网络IO异常（致命异常），关闭channel以防止资源泄漏
        // 对于其他异常（可能是可恢复的业务异常），只记录日志
        if (cause instanceof IOException) {
            // IOException及其子类（包括SocketException）都是致命的网络异常
            if (cause instanceof SocketException && cause.getMessage() != null && cause.getMessage().contains("Connection reset")) {
                // Connection reset是常见的客户端断开，使用debug级别
                log.debug("[TCP Visitor Channel] connection reset: {}", cause.getMessage());
            } else {
                log.error("[TCP Visitor Channel] IO error", cause);
            }
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else if(cause instanceof DecoderException) {
            // 协议解析错误，为防止数据污染，立即关闭
            log.debug("[TCP Visitor Channel] decoder error: {}", cause.getMessage());
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else {
            // 其他异常只记录日志，不关闭channel，让Netty自己处理
            log.error("[TCP Visitor Channel] error", cause);
        }
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf buf) throws Exception {
        // 通知代理客户端
        Channel visitorChannel = ctx.channel();
        Channel proxyChannel = visitorChannel.attr(Constants.NEXT_CHANNEL).get();

        if (null == proxyChannel) {
            // 该端口还没有代理客户端
            ctx.channel().close();
            return;
        }
        byte[] bytes = new byte[buf.readableBytes()];
        buf.readBytes(bytes);

        // 代理通道可写，则设置访问通道可读。代理通道不可写，则设置访问通道不可读
        visitorChannel.config().setAutoRead(proxyChannel.isWritable());

        // 转发代理数据
        String visitorId = ProxyUtil.getVisitorIdByChannel(visitorChannel);
        proxyChannel.writeAndFlush(ProxyMessage.buildTransferMessage(visitorId, bytes));

        // 增加流量计数
        VisitorChannelAttachInfo visitorChannelAttachInfo = ProxyUtil.getAttachInfo(visitorChannel);
        Solon.context().getBean(FlowReportService.class).addWriteByte(visitorChannelAttachInfo.getLicenseId(), bytes.length);
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {
        Channel visitorChannel = ctx.channel();
        InetSocketAddress sa = (InetSocketAddress) visitorChannel.localAddress();

        Channel cmdChannel = ProxyUtil.getCmdChannelByServerPort(sa.getPort());
        if (null == cmdChannel) {
            // 该端口还没有代理客户端
            ctx.channel().close();
            return;
        }

        // 根据代理服务端端口，获取被代理客户端局域网连接信息
        String lanInfo = ProxyUtil.getClientLanInfoByServerPort(sa.getPort());
        if (StrUtil.isEmpty(lanInfo)) {
            ctx.channel().close();
            return;
        }

        // 用户连接到代理服务器时，设置用户连接不可读，等待代理后端服务器连接成功后再改变为可读状态
        visitorChannel.config().setOption(ChannelOption.AUTO_READ, false);

        String visitorId = ProxyUtil.newVisitorId();
        ProxyUtil.addVisitorChannelToCmdChannel(NetworkProtocolEnum.TCP, cmdChannel, visitorId, visitorChannel, sa.getPort());
        cmdChannel.writeAndFlush(ProxyMessage.buildConnectMessage(visitorId).setData(lanInfo.getBytes()));

        super.channelActive(ctx);
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {

        // 通知代理客户端
        Channel visitorChannel = ctx.channel();
        InetSocketAddress sa = (InetSocketAddress) visitorChannel.localAddress();
        Channel cmdChannel = ProxyUtil.getCmdChannelByServerPort(sa.getPort());

        if (null != cmdChannel) {
            // 用户连接断开，从控制连接中移除
            String visitorId = ProxyUtil.getVisitorIdByChannel(visitorChannel);
            ProxyUtil.removeVisitorChannelFromCmdChannel(cmdChannel, visitorId);

            // 删除代理附加对象
            ProxyUtil.remoteProxyConnectAttachment(visitorId);

            Channel proxyChannel = visitorChannel.attr(Constants.NEXT_CHANNEL).get();
            if (proxyChannel != null && proxyChannel.isActive()) {
                proxyChannel.attr(Constants.NEXT_CHANNEL).remove();
                proxyChannel.attr(Constants.LICENSE_ID).remove();
                proxyChannel.attr(Constants.VISITOR_ID).remove();

                proxyChannel.config().setOption(ChannelOption.AUTO_READ, true);
                // 通知客户端，用户连接已经断开
                proxyChannel.writeAndFlush(ProxyMessage.buildDisconnectMessage(visitorId));

                proxyChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
            }
        }

        super.channelInactive(ctx);
    }

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
                // proxyChannel.config().setAutoRead(visitorChannel.isWritable());
            }
        }

        super.channelWritabilityChanged(ctx);
    }

}
