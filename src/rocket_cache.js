/**
 * Created by Jun.li on 2015/8/12.
 */
"use strict";

var db = require("node-db");
var redis = require("redis");
var Stash = require('node-stash');

global._RocketCache = function (opts) {
    var extend = function (src, dst) {
        for (var property in src) {
            dst[property] = src[property];
        }
        return dst;
    };
    var conf = {
            redis: {
                wait: true,
                ttl: {
                    cache: 600000 * 3,
                    lock: 10000
                }
            },
            timeout: {
                retry: 1000
            },
            lru: {
                max: 1000000,
                maxAge: 600000,
                errTTL: 5000,
                timeout: 5000
            },
            retryLimit: 5
        },
        RocketCache = function (opts) {
            this.init(extend(opts, conf));
        };
    RocketCache.prototype.init = function (conf) {
        this.sql = conf.sql;//mem和redis都没有时，使用sql语句从数据库读取
        this.piece = conf.piece;//数据碎片化(根据id单条查询)
        this.columns = conf.columns;//sql列(对应语句的?)
        this.db_pool_name = conf.db_pool_name;//数据库名
        this.fresh_time = conf.fresh_time || '-';//数据刷新的时间
        this.dbCallBack = conf.dbCallBack;//数据库读取callBack
        this.dbQuery = conf.dbQuery;//数据库读取方法
        this.type = 'RocketCache:' + conf.type;//数据类型
        if (!conf.piece && typeof conf.type === 'undefined') {
            console.error('conf.type 为空');
        }
        if (!isNaN(this.fresh_time)) {
            this.key_set = [];
        }
        this.stash = Stash.createStash(redis.createClient, conf);
        // 定时刷新
        if (this.key_set) {
            var scope = this;
            setInterval(function () {
                scope.key_set.forEach(function (e) {
                    scope.stash.del(e, function (err) {
                        if (err) {
                            console.error('timer stash.del error:', err);
                        }
                    });
                });
                scope.key_set = [];
            }, this.fresh_time);
        }
        // 数据出生时间
        this.birth_times = {};
    };

    RocketCache.prototype.getType = function (callBack) {
        var scope = this;
        var fetch = function (done) {
            scope.dbQuery(scope.sql, scope.dbCallBack, {
                db_pool_name: scope.db_pool_name,
                columns: scope.columns,
                done: done
            });
        };
        var cb = function (err, results) {
            var backResult = results;
            if (err) {
                backResult = null;
                console.error('RocketCache get:', err);
            }
            callBack(backResult);
        };
        var data_key = scope.type;
        this.stash.get(data_key, fetch, cb);
        this.key_set && this.key_set.push(data_key);
    };
    RocketCache.prototype.getPiece = function (opts, keys, callBack, from_db) {
        if (this.piece !== true) {
            return callBack(null);
        }
        if (!Array.isArray(keys)) {
            keys = [keys];
        }
        var scope = this;
        (opts.valid_time === undefined || opts.valid_time === null) && (opts.valid_time = scope.valid_time);
        var data_key = 'RocketCache:' + opts.type + ':' + keys.join('_');
        var fetch = function (done) {
            scope.dbQuery(opts.sql, opts.dbCallBack || scope.dbCallBack, {
                db_pool_name: opts.db_pool_name,
                columns: keys || [],
                done: done
            });
            // 设置数据出生时间
            opts.valid_time && (scope.birth_times[data_key] = Date.now());
        };
        var cb = function (err, results) {
            var backResult = results;
            //var backResult = (typeof  key === 'undefined' ? results : results[key]);
            if (err) {
                backResult = null;
                console.error('RocketCache get:', err);
            }
            callBack(backResult);
        };
        this.key_set && this.key_set.push(data_key);
        // 预返回
        this.stash.get(data_key, fetch, cb);
        // 数据是否已过期
        if ((from_db === true) || (opts.valid_time && (!scope.birth_times[data_key] || (scope.birth_times[data_key] + opts.valid_time < Date.now())))) {
            // 过期删除
            this.del(data_key, function () {
                // 预加载(用户每次都加载内存数据，提升响应度)
                this.stash.get(data_key, fetch, function () {
                });
            });
        }
    };
    RocketCache.prototype.clearType = function (callBack) {
        this.stash.del(this.type, function (err) {
            if (err) {
                console.error('stash.del error:', err);
            }
            callBack();
        });
    };
    RocketCache.prototype.clearPiece = function (opts, keys, callBack) {
        var data_key = 'RocketCache:' + opts.type + ':' + keys.join('_');
        this.del(data_key, callBack);
    };
    RocketCache.prototype.del = function (data_key, callBack) {
        this.stash.del(data_key, function (err) {
            if (err) {
                console.error('stash.del data_key:' + data_key + ' error:', err);
            }
            callBack && callBack();
        });
    };
    return new RocketCache(opts);
};

function RocketPieceCache() {
    return function (opts) {
        opts = opts || {};
        // redis
        opts.redis = {};
        opts.redis.clients = {};
        var redis_conf = opts.redis_conf;
        var client1 = redis.createClient(redis_conf.redis_port, redis_conf.redis_host);
        client1.auth(redis_conf.redis_pass);
        client1.select(15);
        opts.redis.clients.cache = client1;
        var client2 = redis.createClient(redis_conf.redis_port, redis_conf.redis_host);
        client2.auth(redis_conf.redis_pass);
        client2.select(15);
        opts.redis.clients.broadcast = client2;
        // mysql
        opts.dbQuery = db(opts.mysql_conf).query;
        opts.piece = true;
        opts.valid_time = 1000 * 60 * 30;// 默认有效时间30分钟
        opts.dbCallBack = opts.dbCallBack || function (results, params) {
                if (results && results.length > 0) {
                    params.done(null, results);
                } else {
                    console.error('dbCallBack empty or error,results:', results);
                    params.done('db results empty or error');
                }
            };

        return _RocketCache(opts);
    };
}

module.exports = RocketPieceCache;