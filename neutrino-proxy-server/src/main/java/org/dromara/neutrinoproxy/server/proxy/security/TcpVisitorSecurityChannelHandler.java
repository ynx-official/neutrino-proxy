package org.dromara.neutrinoproxy.server.proxy.security;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.handler.codec.DecoderException;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.dromara.neutrinoproxy.core.Constants;
import org.dromara.neutrinoproxy.core.ProxyMessage;
import org.dromara.neutrinoproxy.core.util.IpUtil;
import org.dromara.neutrinoproxy.server.service.PortMappingService;
import org.dromara.neutrinoproxy.server.service.SecurityGroupService;
import org.dromara.neutrinoproxy.server.util.ProxyUtil;
import org.noear.solon.Solon;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.SocketException;

/**
 * @author: aoshiguchen
 * @date: 2023/12/14
 */
@Slf4j
public class TcpVisitorSecurityChannelHandler extends ChannelInboundHandlerAdapter {
    private final SecurityGroupService securityGroupService = Solon.context().getBean(SecurityGroupService.class);
    private final PortMappingService portMappingService = Solon.context().getBean(PortMappingService.class);

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
        Channel visitorChannel = ctx.channel();

        ByteBuf buf = (ByteBuf) msg;
        byte[] bytes = new byte[buf.readableBytes()];
        buf.readBytes(bytes);

        // 判断IP是否在该端口绑定的安全组允许的规则内
        String ip = IpUtil.getRealRemoteIp(new String(bytes));
        if (StringUtils.isEmpty(ip)) {
            ip = IpUtil.getRemoteIp(ctx);
        }
        InetSocketAddress sa = (InetSocketAddress) visitorChannel.localAddress();
        if (!securityGroupService.judgeAllow(ip, portMappingService.getSecurityGroupIdByMappingPort(sa.getPort()))) {
            // 不在安全组规则放行范围内
            ctx.channel().close();
            return;
        }

        // 继续传播
        ctx.channel().attr(Constants.SERVER_PORT).set(sa.getPort());
        buf.resetReaderIndex();
        ctx.fireChannelRead(buf);
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) throws Exception {
        Channel visitorChannel = ctx.channel();
        InetSocketAddress sa = (InetSocketAddress) visitorChannel.localAddress();

        // 判断IP是否在该端口绑定的安全组允许的规则内
        if (!securityGroupService.judgeAllow(IpUtil.getRemoteIp(ctx), portMappingService.getSecurityGroupIdByMappingPort(sa.getPort()))) {
            // 不在安全组规则放行范围内
            ctx.channel().close();
            return;
        }

        // 继续传播
        ctx.fireChannelActive();
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        // 对于网络IO异常（致命异常），关闭channel以防止资源泄漏
        // 对于其他异常（可能是可恢复的业务异常），只记录日志
        if (cause instanceof IOException) {
            // IOException及其子类（包括SocketException）都是致命的网络异常
            if (cause instanceof SocketException && cause.getMessage() != null && cause.getMessage().contains("Connection reset")) {
                // Connection reset是常见的客户端断开，使用debug级别
                log.debug("[TCP Visitor Security Channel] Connection reset: {}", cause.getMessage());
            } else {
                log.error("[TCP Visitor Security Channel] IO error", cause);
            }
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else if(cause instanceof DecoderException) {
            // 协议解析错误，为防止数据污染，立即关闭
            log.debug("[TCP Visitor Security Channel] decoder error: {}", cause.getMessage());
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else {
            // 其他异常只记录日志，不关闭channel，让Netty自己处理
            log.error("[TCP Visitor Security Channel] error", cause);
        }
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

}
