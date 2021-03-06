(function(){
    'use strict';
    var q               = require('q'),
        util            = require('util'),
        zlib            = require('zlib'),
        logger          = require('./logger'),
        expressUtils    = require('./expressUtils');

    function JobManager(cache, opts) {
        var log = logger.getLog(),
            self = this;
        opts = opts || {};
        
        self.cache = cache;

        self.cfg = {
            enabled: !!opts.enabled,
            timeout: opts.timeout || 5*1000,
            cacheTTL: opts.cacheTTL || 60*60*1000,
            urlPrefix: opts.urlPrefix || '/job'
        };

        if (!cache && opts.enabled) {
            log.warn('No cache provided so switching JobManager to disabled');
            self.cfg.enabled = false;
        }
    }
    
    /**
     * Express middelware that sets up a timeout that will send an early response if a request takes
     * too long. After a configured delay, this will send the client a 202 status with the req's
     * uuid, and it will write this response to the cache.
     */
    JobManager.prototype.setJobTimeout = function(req, res, next) {
        var log = logger.getLog(),
            self = this;
        req._job = { timedOut: false };
        
        if (!self.cfg.enabled) {
            return next();
        }

        req._job.timeout = setTimeout(function() {
            req._job.timedOut = true;
            log.info('[%1] Request took too long, sending and caching 202', req.uuid);

            var data = { code: 202, body: { url:
		[self.cfg.urlPrefix, req.uuid].join('/').replace('//','/') } };

            q.npost(zlib, 'gzip', [JSON.stringify(data)])
            .then(function(buff) {
                var compressed = buff.toString('base64');
                return self.cache.add('req:' + req.uuid, compressed, self.cfg.cacheTTL);
            })
            .then(function() {
                log.info('[%1] Successfully wrote 202 to cache', req.uuid);
                expressUtils.sendResponse(res, data);
            })
            .catch(function(error) {
                log.warn('[%1] Failed to write 202 to cache: %2',
                          req.uuid, (error && error.stack || error));
                req._job.timedOut = false;
            });
        }, self.cfg.timeout);
        
        res.on('finish', function() { // ensure that timeout always cleared on sending response
            if (req._job && req._job.timeout) {
                clearTimeout(req._job.timeout);
            }
        });
        
        next();
    };
    
    /**
     * The counterpart to setReqTimeout, which should be called at the end of every request handler
     * in place of res.send. It should be called with the express req and res objects, and the state
     * of the handler's final returned promise (retrieve with promise.inspect()). It will cancel the
     * request timeout if it hasn't fired yet; otherwse, it will cache the final response.
     */
    JobManager.prototype.endJob = function(req, res, promiseResult) {
        var log = logger.getLog(),
            self = this,
            data;
            
        if (promiseResult.state === 'fulfilled') {
            data = promiseResult.value;
        } else {
            data = {
                code: 500,
                body: { error: 'Internal Error', detail: util.inspect(promiseResult.reason) }
            };
        }
            
        if (!self.cfg.enabled || !req._job) {
            return q(expressUtils.sendResponse(res, data));
        }

        if (!req._job.timedOut) {
            clearTimeout(req._job.timeout);
            return q(expressUtils.sendResponse(res, data));
        }
        
        return q.npost(zlib, 'gzip', [JSON.stringify(data)])
        .then(function(buff) {
            var compressed = buff.toString('base64');
            return self.cache.set('req:' + req.uuid, compressed, self.cfg.cacheTTL);
        })
        .then(function() {
            log.info('[%1] Successfully wrote final response to cache', req.uuid);
        })
        .catch(function(error) {
            log.warn('[%1] Failed to write final response to cache: %2',
                      req.uuid, (error && error.stack || error));
            log.info('[%1] Final response: %2', util.inspect(data));
        });
    };

    // Look up a request id in our cache and see if there is a stored result
    JobManager.prototype.getJobResult = function(req, res, id) {
        var log = logger.getLog(),
            self = this;
        
        if (!self.cfg.enabled) {
            log.warn('[%1] Job manager not enabled so cannot get result for %2', req.uuid, id);
            return q(expressUtils.sendResponse(res, {
                code: 404,
                body: 'No result with that id found'
            }));
        }

        log.info('[%1] Looking up result for %2', req.uuid, id);

        return self.cache.get('req:' + id)
        .then(function(resp) {
            if (!resp) {
                log.info('[%1] No result found for request %2', req.uuid, id);
                return expressUtils.sendResponse(res, {
                    code: 404,
                    body: 'No result with that id found'
                });
            }
            
            return q.npost(zlib, 'gunzip', [new Buffer(resp, 'base64')])
            .then(function(dataStr) {
                var data = JSON.parse(dataStr);

                log.info('[%1] Found result with code %2 for %3', req.uuid, data.code, id);
                return expressUtils.sendResponse(res, data);
            });
        })
        .catch(function(error) {
            log.warn('[%1] Failed to lookup %2 in cache: %3', req.uuid, id, error);
            return q.reject('Cache error');
        });
    };

    module.exports = JobManager;
}());
