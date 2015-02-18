var flush = true;
describe('campaignUtils', function() {
    var q, mockLog, logger, promise, adtech, campaignUtils, mockClient, kCamp,
        nextSpy, doneSpy, errorSpy, req;
    
    beforeEach(function() {
        jasmine.Clock.useMock();

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        promise         = require('../../lib/promise');
        campaignUtils   = require('../../lib/campaignUtils');
        
        mockLog = {
            trace : jasmine.createSpy('log_trace'),
            error : jasmine.createSpy('log_error'),
            warn  : jasmine.createSpy('log_warn'),
            info  : jasmine.createSpy('log_info'),
            fatal : jasmine.createSpy('log_fatal'),
            log   : jasmine.createSpy('log_log')
        };
        spyOn(logger, 'createLog').andReturn(mockLog);
        spyOn(logger, 'getLog').andReturn(mockLog);
        
        req = { uuid: '1234' };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
        
        mockClient = {client: 'yes'};
        
        ['adtech/lib/campaign', 'adtech/lib/banner', 'adtech/lib/keyword', 'adtech/lib/push'].forEach(function(key) {
            delete require.cache[require.resolve(key)];
        });
        adtech = require('adtech');
        kCamp = adtech.constants.ICampaign;
        adtech.campaignAdmin = require('adtech/lib/campaign');
        adtech.bannerAdmin = require('adtech/lib/banner');
        adtech.keywordAdmin = require('adtech/lib/keyword');
        adtech.pushAdmin = require('adtech/lib/push');
        ['campaignAdmin', 'bannerAdmin', 'keywordAdmin', 'pushAdmin'].forEach(function(admin) {
            Object.keys(adtech[admin]).forEach(function(prop) {
                if (typeof adtech[admin][prop] !== 'function') {
                    return;
                }
                adtech[admin][prop] = adtech[admin][prop].bind(adtech[admin], mockClient);
                spyOn(adtech[admin], prop).andCallThrough();
            });
        });
    });
    
    describe('objectify', function() {
        it('should transform all of a list\'s items into objects', function() {
            expect(campaignUtils.objectify(['e1', 'e2', 'bananas'])).toEqual([{id: 'e1'}, {id: 'e2'}, {id: 'bananas'}]);
            expect(campaignUtils.objectify(['e1', {id: 'e2'}, 'bananas'])).toEqual([{id: 'e1'}, {id: 'e2'}, {id: 'bananas'}]);
            expect(campaignUtils.objectify([{foo: 'bar'}, {id: 'e2'}, 'bananas'])).toEqual([{foo: 'bar'}, {id: 'e2'}, {id: 'bananas'}]);
        });
        
        it('should just return a non-list param', function() {
            expect(campaignUtils.objectify(undefined)).toEqual(undefined);
            expect(campaignUtils.objectify('bananas')).toEqual('bananas');
        });
    });
    
    describe('getAccountIds', function() {
        var req, advertColl, custColl;
        beforeEach(function() {
            req = { uuid: '1234', body: { advertiserId: 'a-1', customerId: 'cu-1' } };
            advertColl = {
                findOne: jasmine.createSpy('advertColl.findOne').andCallFake(function(query, fields, cb) {
                    if (query.id === 'a-1') cb(null, {id: 'a-1', adtechId: 123});
                    else if (query.id === 'a-bad') cb('ADVERTS GOT A PROBLEM');
                    else cb();
                })
            };
            custColl = {
                findOne: jasmine.createSpy('custColl.findOne').andCallFake(function(query, fields, cb) {
                    if (query.id === 'cu-1') cb(null, {id: 'cu-1', adtechId: 456});
                    else if (query.id === 'cu-bad') cb('CUSTS GOT A PROBLEM');
                    else cb();
                })
            };
        });
        
        it('should lookup the advertiser and customer', function(done) {
            campaignUtils.getAccountIds(advertColl, custColl, req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req._advertiserId).toBe(123);
                expect(req._customerId).toBe(456);
                expect(advertColl.findOne).toHaveBeenCalledWith({id: 'a-1'}, {id: 1, adtechId: 1}, jasmine.any(Function));
                expect(custColl.findOne).toHaveBeenCalledWith({id: 'cu-1'}, {id: 1, adtechId: 1}, jasmine.any(Function));
                done();
            });
        });
        
        it('should call done if one of the two is not found', function(done) {
            var req1 = { uuid: '1234', body: {}, origObj: { advertiserId: 'a-1', customerId: 'cu-2' } },
                req2 = { uuid: '1234', body: {}, origObj: { advertiserId: 'a-2', customerId: 'cu-1' } };
            campaignUtils.getAccountIds(advertColl, custColl, req1, nextSpy, doneSpy).catch(errorSpy);
            campaignUtils.getAccountIds(advertColl, custColl, req2, nextSpy, doneSpy).catch(errorSpy);

            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(doneSpy.calls.length).toBe(2);
                expect(doneSpy.calls[0].args).toEqual([{code: 400, body: 'customer cu-2 does not exist'}]);
                expect(doneSpy.calls[1].args).toEqual([{code: 400, body: 'advertiser a-2 does not exist'}]);
                expect(mockLog.warn.calls.length).toBe(2);
                expect(req1._advertiserId).toBe(123);
                expect(req1._customerId).not.toBeDefined();
                expect(req2._advertiserId).not.toBeDefined();
                expect(req2._customerId).toBe(456);
                done();
            });
        });
        
        it('should reject if one of the two calls fails', function(done) {
            var req1 = { uuid: '1234', body: { advertiserId: 'a-1', customerId: 'cu-bad' } },
                req2 = { uuid: '1234', body: { advertiserId: 'a-bad', customerId: 'cu-1' } };
            campaignUtils.getAccountIds(advertColl, custColl, req1, nextSpy, doneSpy).catch(errorSpy);
            campaignUtils.getAccountIds(advertColl, custColl, req2, nextSpy, doneSpy).catch(errorSpy);

            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy.calls.length).toBe(2);
                expect(errorSpy.calls[0].args).toEqual([new Error('Mongo error')]);
                expect(errorSpy.calls[1].args).toEqual([new Error('Mongo error')]);
                expect(mockLog.error.calls.length).toBe(2);
                done();
            });
        });
    });

    describe('makeKeywordLevels', function() {
        it('should call makeKeywords for each level', function(done) {
            spyOn(campaignUtils, 'makeKeywords').andCallFake(function(keywords) {
                return keywords && keywords.map(function(keyword, idx) { return keyword + idx; });
            });
            campaignUtils.makeKeywordLevels({level1: ['foo', 'bar'], level2: []}).then(function(keys) {
                expect(keys).toEqual({level1: ['foo0', 'bar1'], level2: [], level3: undefined});
                expect(campaignUtils.makeKeywords.calls.length).toBe(3);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(['foo', 'bar']);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith([]);
                expect(campaignUtils.makeKeywords).toHaveBeenCalledWith(undefined);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if any of the makeKeywords calls fails', function(done) {
            spyOn(campaignUtils, 'makeKeywords').andCallFake(function(keywords) {
                if (!keywords) return q.reject('I GOT A PROBLEM');
                return keywords.map(function(keyword, idx) { return keyword + idx; });
            });
            campaignUtils.makeKeywordLevels({level1: ['foo', 'bar'], level2: []}).then(function(keys) {
                expect(keys).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toBe('I GOT A PROBLEM');
                expect(campaignUtils.makeKeywords.calls.length).toBe(3);
            }).done(done);
        });
    });
    
    describe('makeKeywords', function() {
        var keywords;
        beforeEach(function() {
            campaignUtils._keywordCache = new promise.Keeper();;
            keywords = ['key123', 'key456'];
            adtech.keywordAdmin.registerKeyword.andCallFake(function(keyword) {
                return q(parseInt(keyword.match(/\d+/)[0]));
            });
        });
        
        it('should register a list of keywords', function(done) {
            campaignUtils.makeKeywords(keywords).then(function(ids) {
                expect(ids).toEqual([123, 456]);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).toBeDefined();
                expect(campaignUtils._keywordCache.getDeferred('key456', true)).toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword).toHaveBeenCalledWith('key123');
                expect(adtech.keywordAdmin.registerKeyword).toHaveBeenCalledWith('key456');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should handle undefined keyword lists', function(done) {
            campaignUtils.makeKeywords().then(function(ids) {
                expect(ids).not.toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should retrieve ids from the cache if defined', function(done) {
            campaignUtils._keywordCache.defer('key123').resolve(123);
            campaignUtils.makeKeywords(keywords).then(function(ids) {
                expect(ids).toEqual([123, 456]);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).toBeDefined();
                expect(campaignUtils._keywordCache.getDeferred('key456', true)).toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword).not.toHaveBeenCalledWith('key123');
                expect(adtech.keywordAdmin.registerKeyword).toHaveBeenCalledWith('key456');
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should eventually delete keywords from the cache', function(done) {
            campaignUtils.makeKeywords(keywords.slice(0, 1)).then(function(ids) {
                expect(ids).toEqual([123]);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).toBeDefined();
                jasmine.Clock.tick(1000*60*60*24 + 1);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).not.toBeDefined();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if the call to adtech fails, and not cache errors', function(done) {
            var callCount = 0;
            adtech.keywordAdmin.registerKeyword.andCallFake(function(keyword) {
                if (keyword === 'key123') {
                    if (callCount === 0) {
                        callCount++;
                        return q.reject('I GOT A PROBLEM');
                    }
                }
                return q(parseInt(keyword.match(/\d+/)[0]));
            });
            campaignUtils.makeKeywords(['key123', 'key456', 'key123']).then(function(ids) {
                expect(ids).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils._keywordCache.getDeferred('key456', true)).toBeDefined();
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).not.toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword.calls.length).toBe(2);
                return campaignUtils.makeKeywords(['key123']);
            }).then(function(ids) {
                expect(ids).toEqual([123]);
                expect(campaignUtils._keywordCache.getDeferred('key123', true)).toBeDefined();
                expect(adtech.keywordAdmin.registerKeyword.calls.length).toBe(3);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
    });
    
    describe('formatCampaign', function() {
        var campaign, now, keywords, features;
        beforeEach(function() {
           now = new Date();
           campaign = {id: 'cam-1', name: 'camp1', created: now, advertiserId: '123', customerId: '456'};
           keywords = { level1: [12, 23], level3: [34] };
           features = {targeting:true,placements:true,frequency:true,schedule:true,
                       ngkeyword:true,keywordLevel:true,volume:true};
        });
        
        it('should format a campaign for saving to adtech', function() {
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(fmt.adGoalTypeId).toBe(1);
            expect(fmt.advertiserId).toBe(123);
            expect(fmt.campaignFeatures).toEqual(features);
            expect(fmt.campaignTypeId).toBe(26954);
            expect(fmt.customerId).toBe(456);
            expect(fmt.dateRangeList).toEqual([{deliveryGoal: {desiredImpressions: 1000000000},
                endDate: jasmine.any(String), startDate: jasmine.any(String)}]);
            expect(fmt.extId).toBe('cam-1');
            expect(fmt.frequencyConfig).toEqual({type: -1});
            expect(fmt.id).not.toBeDefined();
            expect(fmt.name).toBe('camp1');
            expect(fmt.optimizerTypeId).toBe(6);
            expect(fmt.optimizingConfig).toEqual({minClickRate: 0, minNoPlacements: 0});
            expect(fmt.pricingConfig).toEqual({cpm: 0, invoiceImpressions : 1000000000});
            expect(fmt.priority).toBe(3);
            expect(fmt.priorityLevelOneKeywordIdList).not.toBeDefined();
            expect(fmt.priorityLevelThreeKeywordIdList).not.toBeDefined();
            expect(fmt.viewCount).toBe(true);
        });
        
        it('should be able to set keywords', function() {
            var fmt = campaignUtils.formatCampaign(campaign, keywords);
            expect(fmt.priorityLevelOneKeywordIdList).toEqual([12, 23]);
            expect(fmt.priorityLevelThreeKeywordIdList).toEqual([34]);
        });
        
        it('should set a higher priority if the campaign is sponsored', function() {
            var fmt = campaignUtils.formatCampaign(campaign, null, true);
            expect(fmt.priority).toBe(2);
        });
        
        it('should set the campaign adtech id if defined', function() {
            campaign.adtechId = 987;
            var fmt = campaignUtils.formatCampaign(campaign);
            expect(fmt.id).toBe(987);
        });
    });
    
    describe('createCampaign', function() {
        beforeEach(function() {
            spyOn(campaignUtils, 'formatCampaign').andReturn({formatted: 'yes'});
            adtech.campaignAdmin.createCampaign.andReturn(q({id: 123, campaign: 'yes'}));
        });
        
        it('should format and create a campaign', function(done) {
            campaignUtils.createCampaign('cam-1', 'camp 1', true, {keys: 'yes'}, 45, 56).then(function(resp) {
                expect(resp).toEqual({id: 123, campaign: 'yes'});
                expect(campaignUtils.formatCampaign).toHaveBeenCalledWith({id: 'cam-1', name: 'camp 1',
                    advertiserId: 45, customerId: 56, created: jasmine.any(Date)}, {keys: 'yes'}, true);
                expect(adtech.campaignAdmin.createCampaign).toHaveBeenCalledWith({formatted: 'yes'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if creating the campaign fails', function(done) {
            adtech.campaignAdmin.createCampaign.andReturn(q.reject('ADTECH IS THE WORST'));
            campaignUtils.createCampaign('cam-1', 'camp 1', true, {keys: 'yes'}, 45, 56).then(function(resp) {
                expect(resp).not.toBeDefined();
            }).catch(function(error) {
                expect(error).toEqual(new Error('ADTECH IS THE WORST'));
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('editCampaign', function() {
        var name, keys;
        beforeEach(function() {
            name = 'new';
            keys = { level1: [31, 32, 33], level3: [41] };
            adtech.campaignAdmin.getCampaignById.andReturn(q({id: 123, foo: null, name: 'old',
                priorityLevelOneKeywordIdList: [11, 12], priorityLevelThreeKeywordIdList: [21, 22]}));
            adtech.campaignAdmin.updateCampaign.andReturn(q());
        });
        
        it('should be capable of editing the name and keywords', function(done) {
            campaignUtils.editCampaign(123, name, keys).then(function() {
                expect(adtech.campaignAdmin.getCampaignById).toHaveBeenCalledWith(123);
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({id: 123, name: 'new',
                    priorityLevelOneKeywordIdList: [31, 32, 33], priorityLevelThreeKeywordIdList: [41]});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not change the name if no new name is provided', function(done) {
            campaignUtils.editCampaign(123, undefined, keys).then(function() {
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({id: 123, name: 'old',
                    priorityLevelOneKeywordIdList: [31, 32, 33], priorityLevelThreeKeywordIdList: [41]});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not update a keyword list if a new list of that level is not provided', function(done) {
            delete keys.level1;
            campaignUtils.editCampaign(123, 'new', keys).then(function() {
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({id: 123, name: 'new',
                    priorityLevelOneKeywordIdList: [11, 12], priorityLevelThreeKeywordIdList: [41]});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not update the keywords if new keys are not provided at all', function(done) {
            campaignUtils.editCampaign(123, 'new', undefined).then(function() {
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalledWith({id: 123, name: 'new',
                    priorityLevelOneKeywordIdList: [11, 12], priorityLevelThreeKeywordIdList: [21, 22]});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if retrieving the campaign failed', function(done) {
            adtech.campaignAdmin.getCampaignById.andReturn(q.reject('ADTECH IS THE WORST'));
            campaignUtils.editCampaign(123, 'new', keys).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('ADTECH IS THE WORST'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.campaignAdmin.updateCampaign).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if updating the campaign failed', function(done) {
            adtech.campaignAdmin.updateCampaign.andReturn(q.reject('ADTECH IS THE WORST'));
            campaignUtils.editCampaign(123, 'new', keys).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('ADTECH IS THE WORST'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.campaignAdmin.getCampaignById).toHaveBeenCalled();
                expect(adtech.campaignAdmin.updateCampaign).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('pollStatuses', function() {
        var deferreds, desired, tick;
        beforeEach(function() {
            deferreds = { 123: q.defer(), 234: q.defer(), 345: q.defer() };
            desired = kCamp.STATUS_EXPIRED;
            spyOn(campaignUtils, 'pollStatuses').andCallThrough();
            adtech.campaignAdmin.getCampaignStatusValues.andCallFake(function(ids) {
                var results = {};
                ids.forEach(function(id, idx) {
                    if (idx === 0) results[id] = desired;
                    else results[id] = kCamp.STATUS_PENDING;
                });
                return q(results);
            });
            tick = function() {
                var def = q.defer();
                process.nextTick(function() {
                    jasmine.Clock.tick(1000);
                    def.resolve();
                });
                return def.promise;
            };
        });
        
        it('should poll for campaign statuses until all have succesfully transitioned', function(done) {
            campaignUtils.pollStatuses(deferreds, desired, 1000, 3).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(campaignUtils.pollStatuses.calls.length).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.length).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[0].args).toEqual([['123', '234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[1].args).toEqual([['234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[2].args).toEqual([['345']]);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);

            tick().then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'pending'});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'pending'});
            }).then(tick).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'pending'});
            }).then(tick);
        });

        it('should do nothing if there are no campaigns to check', function(done) {
            deferreds = {};
            campaignUtils.pollStatuses(deferreds, desired, 1000, 3).then(function() {
                expect(adtech.campaignAdmin.getCampaignStatusValues).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should just log a warning if a getCampaignStatusValues call fails', function(done) {
            adtech.campaignAdmin.getCampaignStatusValues.andCallFake(function(ids) {
                if (this.getCampaignStatusValues.calls.length === 2) return q.reject('I GOT A PROBLEM');
                var results = {};
                ids.forEach(function(id, idx) {
                    if (idx === 0) results[id] = desired;
                    else results[id] = kCamp.STATUS_PENDING;
                });
                return q(results);
            });
            campaignUtils.pollStatuses(deferreds, desired, 1000, 4).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(campaignUtils.pollStatuses.calls.length).toBe(4);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.length).toBe(4);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[0].args).toEqual([['123', '234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[1].args).toEqual([['234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[2].args).toEqual([['234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[3].args).toEqual([['345']]);
                expect(mockLog.warn).toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
            
            tick().then(tick).then(tick).then(tick);
        });
        
        it('should reject any promises for campaigns that don\'t succeed in time', function(done) {
            campaignUtils.pollStatuses(deferreds, desired, 1000, 2).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'fulfilled', value: undefined});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'rejected', reason: 'Status for 345 is 10 after 2 poll attempts'});
                expect(campaignUtils.pollStatuses.calls.length).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.length).toBe(2);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[0].args).toEqual([['123', '234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[1].args).toEqual([['234', '345']]);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
            
            tick().then(tick);
        });
        
        it('should stop checking a campaign if its status becomes an error status', function(done) {
            adtech.campaignAdmin.getCampaignStatusValues.andCallFake(function(ids) {
                var results = {};
                ids.forEach(function(id, idx) {
                    if (idx === 0) results[id] = kCamp.STATUS_ERROR_STOPPING;
                    else results[id] = kCamp.STATUS_PENDING;
                });
                return q(results);
            });
            campaignUtils.pollStatuses(deferreds, desired, 1000, 3).then(function() {
                expect(deferreds[123].promise.inspect()).toEqual({state: 'rejected', reason: 'Status for 123 is STATUS_ERROR_STOPPING'});
                expect(deferreds[234].promise.inspect()).toEqual({state: 'rejected', reason: 'Status for 234 is STATUS_ERROR_STOPPING'});
                expect(deferreds[345].promise.inspect()).toEqual({state: 'rejected', reason: 'Status for 345 is STATUS_ERROR_STOPPING'});
                expect(campaignUtils.pollStatuses.calls.length).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls.length).toBe(3);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[0].args).toEqual([['123', '234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[1].args).toEqual([['234', '345']]);
                expect(adtech.campaignAdmin.getCampaignStatusValues.calls[2].args).toEqual([['345']]);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
            
            tick().then(tick).then(tick);
        });
    });
    
    describe('deleteCampaigns', function() {
        var ids;
        beforeEach(function() {
            ids = [123, 234, 345];
            adtech.pushAdmin.stopCampaignById.andReturn(q());
            adtech.campaignAdmin.deleteCampaign.andReturn(q());
            spyOn(campaignUtils, 'pollStatuses').andCallFake(function(deferreds) {
                Object.keys(deferreds).forEach(function(id) { deferreds[id].resolve(); });
            });
        });
        
        it('should stop and delete campaigns', function(done) {
            campaignUtils.deleteCampaigns(ids, 1000, 10).then(function() {
                expect(adtech.pushAdmin.stopCampaignById.calls.length).toBe(3);
                expect(adtech.campaignAdmin.deleteCampaign.calls.length).toBe(3);
                ids.forEach(function(id) {
                    expect(adtech.pushAdmin.stopCampaignById).toHaveBeenCalledWith(id);
                    expect(adtech.campaignAdmin.deleteCampaign).toHaveBeenCalledWith(id);
                });
                expect(campaignUtils.pollStatuses).toHaveBeenCalledWith({123: jasmine.any(Object),
                    234: jasmine.any(Object), 345: jasmine.any(Object)}, kCamp.STATUS_EXPIRED, 1000, 10);
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if there are no ids', function(done) {
            campaignUtils.deleteCampaigns(undefined, 1000, 10).then(function() {
                return campaignUtils.deleteCampaigns([], 1000, 10);
            }).then(function() {
                expect(adtech.pushAdmin.stopCampaignById).not.toHaveBeenCalled();
                expect(adtech.campaignAdmin.deleteCampaign).not.toHaveBeenCalled();
                expect(campaignUtils.pollStatuses).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should fail early if any of the stop calls fails', function(done) {
            adtech.pushAdmin.stopCampaignById.andCallFake(function(id) {
                if (id === 234) return q.reject('I GOT A PROBLEM');
                else return q();
            });
            campaignUtils.deleteCampaigns(ids, 1000, 10).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.pushAdmin.stopCampaignById.calls.length).toBe(3);
                expect(adtech.campaignAdmin.deleteCampaign).not.toHaveBeenCalled();
                expect(campaignUtils.pollStatuses).not.toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if one of the campaigns fails to transition states', function(done) {
            campaignUtils.pollStatuses.andCallFake(function(deferreds) {
                Object.keys(deferreds).forEach(function(id) {
                    if (id === '123') deferreds[id].reject('I GOT A PROBLEM');
                    else deferreds[id].resolve();
                });
            });
            campaignUtils.deleteCampaigns(ids, 1000, 10).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.pushAdmin.stopCampaignById.calls.length).toBe(3);
                expect(adtech.campaignAdmin.deleteCampaign.calls.length).toBe(2);
                expect(campaignUtils.pollStatuses).toHaveBeenCalled();
            }).done(done);
        });
        
        it('should reject if deleting one of the campaigns fails', function(done) {
            adtech.campaignAdmin.deleteCampaign.andCallFake(function(id) {
                if (id === 345) return q.reject('I GOT A PROBLEM');
                else return q();
            });
            campaignUtils.deleteCampaigns(ids, 1000, 10).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Adtech failure'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.pushAdmin.stopCampaignById.calls.length).toBe(3);
                expect(adtech.campaignAdmin.deleteCampaign.calls.length).toBe(3);
                expect(campaignUtils.pollStatuses).toHaveBeenCalled();
            }).done(done);
        });
    });
});