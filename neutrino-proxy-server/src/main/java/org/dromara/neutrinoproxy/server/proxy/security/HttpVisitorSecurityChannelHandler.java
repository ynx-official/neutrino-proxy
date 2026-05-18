package org.dromara.neutrinoproxy.server.proxy.security;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.*;
import io.netty.handler.codec.DecoderException;
import io.netty.util.CharsetUtil;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.checkerframework.checker.i18nformatter.qual.I18nFormat;
import org.dromara.neutrinoproxy.core.Constants;
import org.dromara.neutrinoproxy.core.ProxyMessage;
import org.dromara.neutrinoproxy.core.util.HttpUtil;
import org.dromara.neutrinoproxy.core.util.IpUtil;
import org.dromara.neutrinoproxy.server.service.DomainService;
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
public class HttpVisitorSecurityChannelHandler extends ChannelInboundHandlerAdapter {
    private final SecurityGroupService securityGroupService = Solon.context().getBean(SecurityGroupService.class);
    private final PortMappingService portMappingService = Solon.context().getBean(PortMappingService.class);
    private final DomainService domainService = Solon.context().getBean(DomainService.class);
    /**
     * 域名
     */
    private Boolean isHttps;

    // 拼接收到的 ByteBuf 内容
    private ByteBuf cumulationBuf = Unpooled.buffer();
//    private boolean initialized = false;

    public HttpVisitorSecurityChannelHandler(Boolean isHttps) {
        this.isHttps = isHttps;
    }
    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
//        if (initialized) {
//            // 已经初始化，直接透传
//            ctx.fireChannelRead(msg);
//            return;
//        }

        // 累加数据包
        ByteBuf buf = (ByteBuf) msg;
        cumulationBuf.writeBytes(buf);

        String dataStr = cumulationBuf.toString(CharsetUtil.UTF_8);
        int headerEndIndex = dataStr.indexOf("\r\n\r\n");
        if (-1 == headerEndIndex) {
            // 请求头还没读完，继续等
            return;
        }

        // 获取Host请求头
        String headerPart = dataStr.substring(0, headerEndIndex + 4);
        String host = HttpUtil.getHostIgnorePort(headerPart); //test1.asgc.fun

        log.debug("HttpProxy host: {}", host);
        if (StringUtils.isBlank(host)) {
            ctx.channel().close();
            return;
        }
        // 判断域名是否被禁用或删除
        Integer domainNameId = ProxyUtil.getDomainNameIdByFullDomain(host);
        if (domainNameId == null) {
            ctx.channel().close();
            return;
        }
        // 域名映射强制https验证
        if (!isHttps && domainService.isOnlyHttps(domainNameId)) {
            ctx.channel().close();
            return;
        }

        Integer serverPort = ctx.channel().attr(Constants.SERVER_PORT).get();
        if (null == serverPort) {
            // channel没有服务器端口信息，尝试根据完整域名拿到服务端端口
            serverPort = ProxyUtil.getServerPortByFullDomain(host);
            if (null == serverPort) {
                ctx.channel().close();
                return;
            }

            // 判断IP是否在该端口绑定的安全组允许的规则内
            String ip = IpUtil.getRealRemoteIp(headerPart);
            if (ip == null) {
                ip = IpUtil.getRemoteIp(ctx);
            }
            if (!securityGroupService.judgeAllow(ip, portMappingService.getSecurityGroupIdByMappingPort(serverPort))) {
                // 不在安全组规则放行范围内
                ctx.channel().close();
                return;
            }

            ctx.channel().attr(Constants.REAL_REMOTE_IP).set(ip);
            ctx.channel().attr(Constants.SERVER_PORT).set(serverPort);
        }

        // 从此之后所有的 in 都是“直接透传”。
        // 否则，若请求体过长，数据包被拆分为多个，后续的数据包都无法解析出host，导致转发数据不完整。
        ctx.pipeline().remove(this);

        // 继续传播
        ctx.fireChannelRead(cumulationBuf);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
        // 对于网络IO异常（致命异常），关闭channel以防止资源泄漏
        // 对于其他异常（可能是可恢复的业务异常），只记录日志
        if (cause instanceof IOException) {
            // IOException及其子类（包括SocketException）都是致命的网络异常
            if (cause instanceof SocketException && cause.getMessage() != null && cause.getMessage().contains("Connection reset")) {
                // Connection reset是常见的客户端断开，使用debug级别
                log.debug("[HTTP Visitor Security Channel] Connection reset: {}", cause.getMessage());
            } else {
                log.error("[HTTP Visitor Security Channel] IO error", cause);
            }
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else if(cause instanceof DecoderException) {
            // 协议解析错误，为防止数据污染，立即关闭
            log.debug("[HTTP Visitor Security Channel] decoder error: {}", cause.getMessage());
            if (ctx.channel().isActive()) {
                ctx.channel().close();
            }
        } else {
            // 其他异常只记录日志，不关闭channel，让Netty自己处理
            log.error("[HTTP Visitor Security Channel] error", cause);
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
