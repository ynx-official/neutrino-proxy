package org.dromara.neutrinoproxy.client.util;

import io.netty.channel.Channel;
import lombok.Data;
import lombok.experimental.Accessors;

import java.util.Date;

/**
 * @author: aoshiguchen
 * @date: 2023/9/21
 */
@Accessors(chain = true)
@Data
public class LockChannel {
    // 端口号
    private int port;
    // 通道
    private Channel channel;
    // 期望的响应次数
    private int proxyResponses;
    // 超时时间（毫秒）
    private long proxyTimeoutMs;
    // 被获取的时间
    private Date takeTime;
    // 最后一次活跃的时间（最后发生读写的时间）,每次发送或响应需要重置
    private Date lastActiveTime;
    // 已经响应的次数(相对于最后一次发送的时，每次发送后需要重置)
    private int responseCount;
}
