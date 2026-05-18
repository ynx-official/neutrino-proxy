package org.dromara.neutrinoproxy.server.controller;

import org.dromara.neutrinoproxy.server.base.rest.Authorization;
import org.dromara.neutrinoproxy.server.controller.res.stats.StatsInfoRes;
import org.dromara.neutrinoproxy.server.util.ProxyUtil;
import org.noear.solon.annotation.Controller;
import org.noear.solon.annotation.Get;
import org.noear.solon.annotation.Mapping;

/**
 *
 * @author: wen.y
 * @date: 2026/1/20
 */
@Mapping("/stats")
@Controller
public class StatsController {

    @Authorization(login = false)
    @Get
    @Mapping("/info")
    public StatsInfoRes info() {
        return new StatsInfoRes().setCacheInfo(ProxyUtil.getCacheInfo());
    }

}
