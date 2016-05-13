(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        ld              = require('lodash'),
        express         = require('express'),
        authUtils       = require('../lib/authUtils'),
        CrudSvc         = require('../lib/crudSvc'),
        logger          = require('../lib/logger'),

        advertModule = {};
    
    advertModule.advertSchema = {
        name: {
            __allowed: true,
            __type: 'string',
            __required: true
        },
        defaultLinks: {
            __allowed: true,
            __type: 'object'
        },
        defaultLogos: {
            __allowed: true,
            __type: 'object'
        },
        beeswaxIds: {
            __allowed: false,
            __type: 'object'
        }
    };

    advertModule.setupSvc = function(coll, beeswax) {
        var opts = { userProp: false },
            svc = new CrudSvc(coll, 'a', opts, advertModule.advertSchema);
            
        svc.use('create', advertModule.createBeeswaxAdvert.bind(advertModule, beeswax));

        svc.use('edit', advertModule.editBeeswaxAdvert.bind(advertModule, beeswax));
        
        return svc;
    };
    
    /* jshint camelcase: false */
    advertModule.handleNameInUse = function(req, beesBody, cb) { //TODO: rename, rethink?
        var log = logger.getLog();
        return cb().catch(function(errorObj) {
            if (!(/Advertiser name already in use/.test(errorObj.message))) {
                return q.reject(errorObj);
            }
            
            var newName = beesBody.advertiser_name + ' (' + beesBody.alternative_id + ')';
            log.info('[%1] Name %2 already used in Beeswax, trying name %3',
                     req.uuid, beesBody.advertiser_name, newName);
            
            beesBody.advertiser_name = newName;
            return cb();
        });
    };
    
    advertModule.createBeeswaxAdvert = function(beeswax, req, next/*, done*/) {
        var log = logger.getLog(),
            c6Id = req.body.id,
            beesId;
        
        var beesBody = {
            alternative_id: c6Id,
            advertiser_name: req.body.name
        };
        
        return advertModule.handleNameInUse(req, beesBody, function createAdvert() {
            return beeswax.advertisers.create(beesBody);
        })
        .then(function(resp) {
            /* TODO: don't think this is needed anymore, but unsure?
            if (!resp.success) {
                log.warn('[%1] Creating Beeswax Advertiser failed: %2', req.uuid, resp.message);
                return q({
                    code: resp.code || 400,
                    body: resp.message
                });
            }
            */

            beesId = resp.payload.advertiser_id;
            log.info('[%1] Created Beeswax advertiser %2 for %3', req.uuid, beesId, c6Id);
            
            req.body.beeswaxIds = { advertiser: beesId };
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Error creating Beeswax advert for %2: %3',
                      req.uuid, c6Id, error.message || util.inspect(error));
            return q.reject('Error creating Beeswax advertiser');
        });
    };
    
    advertModule.editBeeswaxAdvert = function(beeswax, req, next/*, done*/) {
        var log = logger.getLog(),
            c6Id = req.origObj.id,
            beesId = ld.get(req.origObj, 'beeswaxIds.advertiser', null);
        
        if (!beesId) {
            log.info('[%1] C6 advert %2 has no Beeswax advert', req.uuid, c6Id);
            return q(next()); //TODO: or call createBeeswaxAdvert?
        }
        if (req.body.name === req.origObj.name) {
            log.trace('[%1] Name unchanged, not editing Beeswax advert', req.uuid);
            return q(next());
        }
        
        var beesBody = {
            alternative_id: c6Id,
            advertiser_name: req.body.name
        };
        
        return advertModule.handleNameInUse(req, beesBody, function editAdvert() {
            return beeswax.advertisers.edit(beesId, beesBody);
        })
        .then(function(/*resp*/) {
            /* TODO: don't think this is needed anymore, but unsure?
            if (!resp.success) {
                log.warn('[%1] Editing Beeswax Advertiser %2 failed: %3',
                         req.uuid, beesId, resp.message);
                return q({
                    code: resp.code || 400,
                    body: resp.message
                });
            }
            */
            log.info('[%1] Edited Beeswax advertiser %2 for %3', req.uuid, beesId, c6Id);
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Error editing Beeswax advert %2 for %3: %4',
                      req.uuid, beesId, c6Id, error.message || util.inspect(error));
            return q.reject('Error editing Beeswax advertiser');
        });
    };
    /* jshint camelcase: true */

    
    advertModule.setupEndpoints = function(app, svc, sessions, audit, jobManager) {
        var router      = express.Router(),
            mountPath   = '/api/account/advertisers?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('advertisers', { allowApps: true });
        
        router.post('/ASDF/:id', function(req, res) {
            logger.getLog().trace('got post for %1', req.params.id);
            res.send(200, { id: 'asdf-' + req.params.id, foo: 'bar' });
        });
        
        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = svc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving advertiser', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            if (req.query.name) {
                query.name = String(req.query.name);
            }
            if (req.query.org) {
                query.org = String(req.query.org);
            }
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }

            var promise = svc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving advertisers', detail: error });
                });
            });
        });
        
        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = svc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating advertiser', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = svc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating advertiser', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req,res) {
            var promise = svc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting advertiser', detail: error });
                });
            });
        });
        
        app.use(mountPath, router);
    };
    
    module.exports = advertModule;
}());
