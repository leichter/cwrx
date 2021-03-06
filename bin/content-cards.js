(function(){
    'use strict';

    var q               = require('q'),
        util            = require('util'),
        express         = require('express'),
        logger          = require('../lib/logger'),
        CrudSvc         = require('../lib/crudSvc'),
        authUtils       = require('../lib/authUtils'),
        mongoUtils      = require('../lib/mongoUtils'),
        Status          = require('../lib/enums').Status,

        cardModule = { config: {} };
    
    cardModule.cardSchema = {
        campaignId: {
            __allowed: true,
            __type: 'string',
            __unchangeable: true,
            __required: true
        },
        campaign: {
            __default: {},
            reportingId: {
                __allowed: true,
                __type: 'string'
            },
            minViewTime: {
                __allowed: false,
                __type: 'number',
                __default: 3
            },
            startDate: {
                __allowed: true,
                __type: 'string'
            },
            endDate: {
                __allowed: true,
                __type: 'string'
            }
        },
        data: {
            __default: {},
            skip: {
                __allowed: false,
                __required: true,
                __default: 5
            },
            controls: {
                __allowed: false,
                __type: 'boolean',
                __required: true,
                __default: true
            },
            autoplay: {
                __allowed: false,
                __type: 'boolean',
                __required: true,
                __default: true
            },
            autoadvance: {
                __allowed: false,
                __type: 'boolean',
                __required: true,
                __default: false
            },
            moat: { // Ensures moat is set to {} for default user, subfields get set in setupMoat()
                __allowed: true,
                __type: 'object',
                __required: true,
                __default: {}
            }
        }
    };


    cardModule.setupSvc = function(db, config, caches, metagetta) {
        var log = logger.getLog();

        cardModule.config.trackingPixel = config.trackingPixel;

        if (!metagetta.hasGoogleKey) {
            log.warn('Missing googleKey from secrets, will not be able to lookup ' +
                'meta data for youtube videos.');
        }
        cardModule.metagetta = metagetta;
    
        var opts = { allowPublic: true },
            svc = new CrudSvc(db.collection('cards'), 'rc', opts, cardModule.cardSchema);
            
        svc._db = db;
        
        var fetchCamp = cardModule.fetchCamp.bind(cardModule, svc);
        
        svc.use('create', fetchCamp);
        svc.use('create', cardModule.getMetaData);
        svc.use('create', cardModule.setupMoat);

        svc.use('edit', fetchCamp);
        svc.use('edit', cardModule.campStatusCheck.bind(cardModule, [Status.Draft]));
        svc.use('edit', cardModule.enforceUpdateLock);
        svc.use('edit', cardModule.getMetaData);
        svc.use('edit', cardModule.setupMoat);
        
        svc.use('delete', fetchCamp);
        svc.use('delete', cardModule.campStatusCheck.bind(cardModule, [
            Status.Draft,
            Status.Pending,
            Status.Canceled,
            Status.Expired
        ]));
        
        svc.getPublicCard   = cardModule.getPublicCard.bind(cardModule, svc, caches);
        svc.chooseCards     = cardModule.chooseCards.bind(cardModule, svc, caches);
        
        return svc;
    };

    /* Middleware to fetch the (undecorated) campaign and attach it as req.campaign.
     * If campaign does not exist, log a message but proceed without req.campaign. */
    cardModule.fetchCamp = function(svc, req, next/*, done*/) {
        var log = logger.getLog(),
            campId = req.body.campaignId || (req.origObj && req.origObj.campaignId);
            
        log.trace('[%1] Fetching campaign %2', req.uuid, String(campId));
        
        return mongoUtils.findObject(
            svc._db.collection('campaigns'),
            { id: String(campId), status: { $ne: Status.Deleted } }
        )
        .then(function(camp) {
            if (camp) {
                req.campaign = camp;
            } else if (req.method.toLowerCase() !== 'post') {
                log.warn('[%1] Campaign %2 not found or deleted', req.uuid, campId);
            }
            
            return next();
        })
        .catch(function(error) {
            log.error('[%1] Failed to fetch campaign %2 from mongo: %3',
                      req.uuid, campId, util.inspect(error));
            return q.reject('Error fetching campaign');
        });
    };

    // Check and 400 if req.campaign.status is not one of the statuses in permitted
    cardModule.campStatusCheck = function(permitted, req, next, done) {
        var log = logger.getLog();

        if (!req.campaign || permitted.indexOf(req.campaign.status) !== -1 ||
                             !!req.requester.entitlements.directEditCampaigns) {
            return next();
        } else {
            log.info('[%1] Action not permitted on %2 campaign', req.uuid, req.campaign.status);
            return done({
                code: 400,
                body: 'Action not permitted on ' + req.campaign.status + ' campaign'
            });
        }
    };

    // Prevent editing a card if its campaign has an updateRequest property
    cardModule.enforceUpdateLock = function(req, next, done) {
        var log = logger.getLog();
        
        if (req.campaign && !!req.campaign.updateRequest) {
            log.info('[%1] Campaign %2 has pending update request %3, cannot edit %4',
                     req.uuid, req.campaign.id, req.campaign.updateRequest, req.origObj.id);
            return done({
                code: 400,
                body: 'Campaign + cards locked until existing update request resolved'
            });
        }
        
        return next();
    };
    
    cardModule.isVideoCard = function(card) {
        return  (card.type === 'youtube') ||
                (card.type === 'adUnit')  ||
                (card.type === 'vimeo')   ||
                (card.type === 'dailymotion')  ||
                (card.type === 'vzaar')   ||
                (card.type === 'wistia')  ||
                (card.type === 'jwplayer')  ||
                (card.type === 'facebook') ||
                ((card.type === 'instagram') && (card.data) && (card.data.type === 'video'));
    };
    
    cardModule.supportedMetadata = function(card) {
        var metadata = [];
        var supportsDuration = ['youtube', 'vimeo', 'dailymotion', 'vzaar', 'wistia', 'facebook'];
        var supportsThumbnails = ['youtube', 'vimeo', 'dailymotion', 'vzaar', 'wistia', 'jwplayer',
            'facebook'];
        if(card.data.vast || card.data.vpaid || supportsDuration.indexOf(card.type) !== -1) {
            metadata.push('duration');
        }
        if(supportsThumbnails.indexOf(card.type) !== -1) {
            metadata.push('thumbnails');
        }
        return metadata;
    };

    cardModule.getMetaData = function(req, next /*, done */) {
        var log = logger.getLog(), opts = { };

        if (!cardModule.isVideoCard(req.body)){
            log.trace('[%1] - CardType [%2] is not a video card.',req.uuid,req.body.type);
            return q(next());
        }

        if (!req.body.data) {
            return q(next());
        }

        if (Object.keys(req.body.data).length === 0){
            return q(next());
        }
        
        var supported = cardModule.supportedMetadata(req.body);
        if (req.origObj && req.origObj.data ) {
            if  (
                    (req.origObj.data.vast === req.body.data.vast) &&
                    (req.origObj.data.vpaid === req.body.data.vpaid) &&
                    (req.origObj.data.videoid === req.body.data.videoid) &&
                    (supported.indexOf('duration') === -1 || req.origObj.data.duration > -1 ) &&
                    (supported.indexOf('thumbnails') === -1 || (
                         req.origObj.data.thumbs &&
                         req.origObj.data.thumbs.small &&
                         req.origObj.data.thumbs.large)) &&
                    (Date.now() - req.origObj.lastUpdated.valueOf() < 60000) ) {
                log.trace('[%1] - Video unchanged, no need to get metadata.',req.uuid);
                req.body.data.duration = req.body.data.duration || req.origObj.data.duration;
                return q(next());
            }
        }
        
        if (req.body.data.vast) {
            opts.type = 'vast';
            opts.uri  = req.body.data.vast;
        } else
        if (req.body.data.vpaid) {
            opts.type = 'vast';
            opts.uri  = req.body.data.vpaid;
        } else {
            switch(req.body.type) {
            case 'youtube':
                if (!cardModule.metagetta.hasGoogleKey) {
                    req.body.data.duration = req.body.data.duration || -1;
                    log.warn('[%1] - Cannot get youtube metadata without secrets.googleKey.',
                        req.uuid);
                    return q(next());
                }
                opts.type   = 'youtube';
                opts.id     = req.body.data.videoid;
                break;
            case 'vimeo':
                opts.type   = 'vimeo';
                opts.id     = req.body.data.videoid;
                break;
            case 'dailymotion':
                opts.type   = 'dailymotion';
                opts.id     = req.body.data.videoid;
                break;
            case 'vzaar':
                opts.type   = 'vzaar';
                opts.id     = req.body.data.videoid;
                break;
            case 'wistia':
                opts.type = 'wistia';
                opts.uri  = req.body.data.href;
                break;
            case 'jwplayer':
                opts.type = 'jwplayer';
                opts.id   = req.body.data.videoid;
                break;
            case 'facebook':
                if (!cardModule.metagetta.hasFacebookCreds) {
                    req.body.data.duration = req.body.data.duration || -1;
                    log.warn('[%1] - Cannot get facebook metadata without secrets.facebook.',
                        req.uuid);
                    return q(next());
                }
                opts.type = 'facebook';
                opts.uri  = req.body.data.href;
                break;
            default:
                req.body.data.duration = req.body.data.duration || -1;
                log.info('[%1] - MetaData unsupported for CardType [%2].',req.uuid,req.body.type);
                return q(next());
            }
        }
        
        opts.fields = supported;

        if ((opts.uri) && (opts.uri.match(/^\/\//))) {
            opts.uri = 'http:' + opts.uri;
        }

        return cardModule.metagetta(opts)
        .then(function(res){
            Object.keys(res).forEach(function(key) {
                var metadata = res[key];
                switch(key) {
                case 'duration':
                    if(metadata) {
                        req.body.data.duration = metadata;
                        log.trace('[%1] - setting duration to [%2]',req.uuid,metadata);
                    } else {
                        req.body.data.duration = req.body.data.duration || -1;
                        delete opts.youtube;
                        delete opts.facebook;
                        log.warn('[%1] - Missing duration for the specified resource. [%2]',
                            req.uuid, JSON.stringify(opts));
                    }
                    break;
                case 'thumbnails':
                    if(metadata && metadata.small && metadata.large) {
                        req.body.data.thumbs = metadata;
                        log.trace('[%1] - setting thumbnails to [%2]', req.uuid,
                            JSON.stringify(metadata));
                    } else {
                        delete opts.youtube;
                        delete opts.facebook;
                        log.warn('[%1] - Missing thumbnails for the specified resource. [%2]',
                            req.uuid, JSON.stringify(opts));
                    }
                    break;
                }
            });
            return next();
        })
        .catch(function(err){
            delete opts.youtube;
            delete opts.facebook;
            req.body.data.duration = req.body.data.duration || -1;
            log.warn('[%1] - [%2] [%3]', req.uuid, err.message, JSON.stringify(opts));
            return next();
        });
    };

    // Setup the data.moat object on the card, if data and data.moat are defined.
    cardModule.setupMoat = function(req, next/*, done*/) {
        var id = req.body.id || (req.origObj && req.origObj.id),
            campaignId = req.body.campaignId || (req.origObj && req.origObj.campaignId),
            advertiserId = req.body.advertiserId || (req.origObj && req.origObj.advertiserId);
        
        if (!req.body.data || !req.body.data.moat) {
            return next();
        }
        
        req.body.data.moat = {
            campaign: campaignId,
            advertiser: advertiserId,
            creative: id
        };
        
        return next();
    };

    // Convert values in links + shareLinks hashes to objects like { url: '...', tracking: [...] }
    cardModule.objectifyLinks = function(card) {
        ['links', 'shareLinks'].forEach(function(prop) {
            if (typeof card[prop] !== 'object') {
                return;
            }
            
            Object.keys(card[prop]).forEach(function(linkName) {
                var origVal = card[prop][linkName];

                if (typeof origVal === 'string') {
                    card[prop][linkName] = {
                        uri: origVal,
                        tracking: []
                    };
                } else {
                    card[prop][linkName].tracking = card[prop][linkName].tracking || [];
                }
            });
        });
    };
    
    // Get a card, using internal cache. Can be used across modules when 1st two args bound in
    cardModule.getPublicCard = function(cardSvc, caches, id, req) {
        var log = logger.getLog(),
            privateFields = ['org', 'user'];

        log.info('[%1] Guest user trying to get card %2', req.uuid, id);

        return caches.cards.getPromise({ id: id })
        .spread(function(card) {
            // only show active cards
            if (!card || card.status !== Status.Active) {
                return q();
            }
            
            log.info('[%1] Retrieved card %2', req.uuid, id);
            
            privateFields.forEach(function(key) { delete card[key]; });
            card = cardSvc.formatOutput(card);
            card.campaign = card.campaign || {};
            cardModule.objectifyLinks(card);
            
            // fetch card's campaign so important props can be copied over
            return caches.campaigns.getPromise({ id: card.campaignId })
            .spread(function(camp) {
                if (!camp || camp.status === Status.Deleted) {
                    log.warn('[%1] Campaign %2 not found for card %3',
                             req.uuid, card.campaignId, card.id);
                    return q();
                }
                
                card.params = card.params || {};
                card.campaign = card.campaign || {};
                card.params.sponsor = camp.advertiserDisplayName || card.params.sponsor;

                return card;
            });
        })
        .catch(function(error) {
            log.error('[%1] Error getting card %2: %3', req.uuid, id, error);
            return q.reject('Mongo error');
        });
    };
    
    // Handle requests for cards from /api/public/content/card/:id endpoints
    cardModule.handlePublicGet = function(req, res, cardSvc, config) {
        return cardSvc.getPublicCard(req.params.id, req)
        .then(function(card) {
            // don't cache for requests in preview mode
            if (!req.query.preview) {
                res.header('cache-control', 'max-age=' + config.cacheTTLs.cloudFront*60);
            }
            
            if (!card) {
                return q({ code: 404, body: 'Card not found' });
            }
            
            // if ext === 'js', return card as a CommonJS module; otherwise return JSON
            if (req.params.ext === 'js') {
                res.header('content-type', 'application/javascript');
                return q({ code: 200, body: 'module.exports = ' + JSON.stringify(card) + ';' });
            } else {
                return q({ code: 200, body: card });
            }
        })
        .catch(function(error) {
            res.header('cache-control', 'max-age=60');
            return q({code: 500, body: { error: 'Error retrieving card', detail: error }});
        });
    };

    cardModule.chooseCards = function(cardSvc, caches, req) {
        var log = logger.getLog(),
            randomize = req.query.random === 'true',
            campId = String(req.query.campaign || ''),
            limit = Math.max(Number(req.query.limit), 0) || Infinity;
        
        if (!campId) {
            return q({ code: 400, body: 'Must provide campaign id' });
        }
        
        // Choose card entries from available, fetch using getPublicCard, and add them to fetched
        function chooseAndFetch(available, fetched, numToFetch) {
            var chosen = [];
            while ((chosen.length + fetched.length) < numToFetch && available.length > 0) {
                var idx = randomize ? Math.floor(Math.random() * available.length) : 0;
                chosen = chosen.concat(available.splice(idx, 1));
            }
            
            return q.all(chosen.map(function(cardEntry) {
                return cardSvc.getPublicCard(cardEntry.id, req);
            }))
            .then(function(cards) {
                fetched = fetched.concat(cards.filter(function(card) { return !!card; }));
                
                // if some cards couldn't be fetched + we don't have enough cards, recurse
                if (fetched.length < numToFetch && available.length > 0) {
                    return chooseAndFetch(available, fetched, numToFetch);
                } else {
                    return fetched;
                }
            });
        }
        
        return caches.campaigns.getPromise({ id: campId })
        .spread(function(camp) {
            if (!camp || camp.status === Status.Deleted) {
                log.info('[%1] Campaign %2 not found', req.uuid, campId);
                return q({ code: 404, body: 'Campaign not found' });
            }
            if (!camp.cards || camp.cards.length === 0) {
                log.info('[%1] No cards in campaign %2', req.uuid, campId);
                return q({
                    code: 200,
                    body: [],
                    headers: { 'content-range': 'items 0-0/0' }
                });
            }
            
            var numToFetch = Math.min(camp.cards.length, limit),
                available = JSON.parse(JSON.stringify(camp.cards));
            
            return chooseAndFetch(available, [], numToFetch)
            .then(function(cards) {
                log.info('[%1] Returning %2 cards from %3', req.uuid, cards.length, campId);
                var resp = { code: 200, body: cards };
                
                if (!randomize) {
                    var rangeStr = 'items ' + (cards.length > 0 ? '1-' : '0-') +
                                   cards.length + '/' + camp.cards.length;
                    resp.headers = { 'content-range': rangeStr };
                }
                
                return q(resp);
            });
        })
        .catch(function(error) {
            log.error('[%1] Error choosing cards from campaign %2: %3',
                      req.uuid, campId, util.inspect(error));
            return q.reject('Mongo error');
        });
    };


    cardModule.setupEndpoints = function(app, cardSvc, sessions, audit, config, jobManager){
        // Public get card; regex at end allows client to optionally specify extension (js|json)
        app.get('/api/public/content/cards?/:id([^.]+).?:ext?', function(req, res) {
            cardModule.handlePublicGet(req, res, cardSvc, config).then(function(resp) {
                res.send(resp.code, resp.body);
            });
        });
        
        app.get('/api/public/content/cards?/', function(req, res) {
            cardSvc.chooseCards(req).then(function(resp) {
                if (resp.headers && resp.headers['content-range']) {
                    res.header('content-range', resp.headers['content-range']);
                }
                res.send(resp.code, resp.body);
            })
            .catch(function(error) {
                res.send(500, { error: 'Error retrieving cards', detail: error });
            });
        });


        // Setup router for non-public card endpoints
        var router      = express.Router(),
            mountPath   = '/api/content/cards?'; // prefix to all endpoints declared here
        
        router.use(jobManager.setJobTimeout.bind(jobManager));
        
        var authMidware = authUtils.crudMidware('cards', { allowApps: true });

        var authGetSchema = authUtils.middlewarify({ allowApps: true });
        router.get('/schema', sessions, authGetSchema, function(req, res) {
            var promise = cardSvc.getSchema(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving schema', detail: error });
                });
            });
        });

        router.get('/:id', sessions, authMidware.read, audit, function(req, res) {
            var promise = cardSvc.getObjs({id: req.params.id}, req, false);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving card', detail: error });
                });
            });
        });

        router.get('/', sessions, authMidware.read, audit, function(req, res) {
            var query = {};
            ['org', 'user', 'campaignId'].forEach(function(field) {
                if (req.query[field]) {
                    query[field] = String(req.query[field]);
                }
            });
            if ('ids' in req.query) {
                query.id = String(req.query.ids).split(',');
            }

            var promise = cardSvc.getObjs(query, req, true);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error retrieving cards', detail: error });
                });
            });
        });

        router.post('/', sessions, authMidware.create, audit, function(req, res) {
            var promise = cardSvc.createObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error creating card', detail: error });
                });
            });
        });

        router.put('/:id', sessions, authMidware.edit, audit, function(req, res) {
            var promise = cardSvc.editObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error updating card', detail: error });
                });
            });
        });

        router.delete('/:id', sessions, authMidware.delete, audit, function(req, res) {
            var promise = cardSvc.deleteObj(req);
            promise.finally(function() {
                jobManager.endJob(req, res, promise.inspect())
                .catch(function(error) {
                    res.send(500, { error: 'Error deleting card', detail: error });
                });
            });
        });

        app.use(mountPath, router);
    };
    
    module.exports = cardModule;
}());
