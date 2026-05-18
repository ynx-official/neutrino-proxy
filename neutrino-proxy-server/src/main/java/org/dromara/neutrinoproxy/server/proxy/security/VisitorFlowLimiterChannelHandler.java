package org.dromara.neutrinoproxy.server.proxy.security;

import io.netty.channel.*;
import io.netty.handler.traffic.ChannelTrafficShapingHandler;
import lombok.extern.slf4j.Slf4j;
import org.dromara.neutrinoproxy.core.Constants;
import org.dromara.neutrinoproxy.server.service.PortMappingService;
import org.dromara.neutrinoproxy.server.service.bo.FlowLimitBO;
import org.noear.solon.Solon;


/**
 * 访问者流量限制器
 * @author: aoshiguchen
 * @date: 2023/12/15
 */
@Slf4j
public class VisitorFlowLimiterChannelHandler extends ChannelInboundHandlerAdapter {
    private final PortMappingService portMappingService = Solon.context().getBean(PortMappingService.class);

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
        Boolean flowLimiterFlag = ctx.channel().attr(Constants.FLOW_LIMITER_FLAG).get();

        if (null == flowLimiterFlag || !flowLimiterFlag) {
            Integer serverPort = ctx.channel().attr(Constants.SERVER_PORT).get();
            Long upLimitRate = null;
            Long downLimitRate = null;
            // 先获取端口映射上的限速设置
            FlowLimitBO flowLimitBO = portMappingService.getFlowLimitByServerPort(serverPort);
            if (null != flowLimitBO) {
                upLimitRate = flowLimitBO.getUpLimitRate();
                downLimitRate = flowLimitBO.getDownLimitRate();
            }
            if (null != upLimitRate || null != downLimitRate) {
                // 如果不全为空，则需要做限速
                ctx.pipeline().addAfter("flowLimiter", "trafficShaping", new ChannelTrafficShapingHandler(downLimitRate == null ? 0 : downLimitRate, upLimitRate == null ? 0 : upLimitRate, 100, 600000));
            }

            // 每个连接第一次处理之后。无论是否限速，该连接后续都不在处理，避免频繁执行影响性能
            ctx.channel().attr(Constants.FLOW_LIMITER_FLAG).set(Boolean.TRUE);
        }

        // 继续传播
        ctx.fireChannelRead(msg);
    }

//    @Override
//    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) throws Exception {
//        // 对于网络IO异常（致命异常），关闭channel以防止资源泄漏
//        // 对于其他异常（可能是可恢复的业务异常），只记录日志
//        if (cause instanceof IOException) {
//            // IOException及其子类（包括SocketException）都是致命的网络异常
//            if (cause instanceof SocketException && cause.getMessage() != null && cause.getMessage().contains("Connection reset")) {
//                // Connection reset是常见的客户端断开，使用debug级别
//                log.debug("[Visitor FlowLimit Channel] Connection reset: {}", cause.getMessage());
//            } else {
//                log.error("[Visitor FlowLimit Channel] IO error", cause);
//            }
//            if (ctx.channel().isActive()) {
//                ctx.channel().close();
//            }
//        } else if(cause instanceof DecoderException) {
//            // 协议解析错误，为防止数据污染，立即关闭
//            log.debug("[Visitor FlowLimit Channel] decoder error: {}", cause.getMessage());
//            if (ctx.channel().isActive()) {
//                ctx.channel().close();
//            }
//        } else {
//            // 其他异常只记录日志，不关闭channel，让Netty自己处理
//            log.error("[Visitor FlowLimit Channel] error", cause);
//        }
//    }

//    @Override
//    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
//
//        // 通知代理客户端
//        Channel visitorChannel = ctx.channel();
//        InetSocketAddress sa = (InetSocketAddress) visitorChannel.localAddress();
//        Channel cmdChannel = ProxyUtil.getCmdChannelByServerPort(sa.getPort());
//
//        if (null != cmdChannel) {
//            // 用户连接断开，从控制连接中移除
//            String visitorId = ProxyUtil.getVisitorIdByChannel(visitorChannel);
//            ProxyUtil.removeVisitorChannelFromCmdChannel(cmdChannel, visitorId);
//
//            // 删除代理附加对象
//            ProxyUtil.remoteProxyConnectAttachment(visitorId);
//
//            Channel proxyChannel = visitorChannel.attr(Constants.NEXT_CHANNEL).get();
//            if (proxyChannel != null && proxyChannel.isActive()) {
//                proxyChannel.attr(Constants.NEXT_CHANNEL).remove();
//                proxyChannel.attr(Constants.LICENSE_ID).remove();
//                proxyChannel.attr(Constants.VISITOR_ID).remove();
//
//                proxyChannel.config().setOption(ChannelOption.AUTO_READ, true);
//                // 通知客户端，用户连接已经断开
//                proxyChannel.writeAndFlush(ProxyMessage.buildDisconnectMessage(visitorId));
//
//                proxyChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
//            }
//        }
//
//        super.channelInactive(ctx);
//    }
}
