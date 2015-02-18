var flush = true;
describe('ads-campaigns (UT)', function() {
    var mockLog, CrudSvc, logger, q, campModule, campaignUtils, bannerUtils, requestUtils, uuid,
        nextSpy, doneSpy, errorSpy, req, anyNum;


    beforeEach(function() {
        if (flush) { for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        logger          = require('../../lib/logger');
        uuid            = require('../../lib/uuid');
        requestUtils    = require('../../lib/requestUtils');
        campModule      = require('../../bin/ads-campaigns');
        campaignUtils   = require('../../lib/campaignUtils');
        bannerUtils   = require('../../lib/bannerUtils');
        CrudSvc         = require('../../lib/crudSvc');
        anyNum = jasmine.any(Number);

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
        
        var keywordCount = 0;
        spyOn(campaignUtils, 'makeKeywords').andCallFake(function(keywords) {
            return q(keywords ? keywords.map(function(key) { return ++keywordCount*100; }) : keywords);
        });
        spyOn(campaignUtils, 'makeKeywordLevels').andCallThrough();
        spyOn(campaignUtils, 'deleteCampaigns').andReturn(q());
        spyOn(campaignUtils, 'editCampaign').andReturn(q());
        spyOn(campaignUtils, 'createCampaign').andCallFake(function() {
            return q({id: String(this.createCampaign.calls.length*1000)});
        });
        spyOn(bannerUtils, 'createBanners').andReturn(q());
        spyOn(bannerUtils, 'cleanBanners').andReturn(q());
        
        campModule.campsCfg = { statusDelay: 1000, statusAttempts: 10 };
        campModule.contentHost = 'test.com';

        req = { uuid: '1234', _advertiserId: 987, _customerId: 876, params: {} };
        nextSpy = jasmine.createSpy('next');
        doneSpy = jasmine.createSpy('done');
        errorSpy = jasmine.createSpy('caught error');
    });

    describe('setupSvc', function() {
        it('should setup the campaign service', function() {
            spyOn(CrudSvc.prototype.preventGetAll, 'bind').andReturn(CrudSvc.prototype.preventGetAll);
            spyOn(campaignUtils.getAccountIds, 'bind').andReturn(campaignUtils.getAccountIds);
            spyOn(campModule.formatOutput, 'bind').andReturn(campModule.formatOutput);
            
            var config = { contentHost: 'foo.com', campaigns: { statusDelay: 100, statusAttempts: 5 } };
            var mockDb = {
                collection: jasmine.createSpy('db.collection()').andCallFake(function(name) {
                    return { collectionName: name };
                })
            };
            var svc = campModule.setupSvc(mockDb, config);
            expect(campaignUtils.getAccountIds.bind).toHaveBeenCalledWith(campaignUtils, svc._advertColl, svc._custColl);
            expect(campModule.formatOutput.bind).toHaveBeenCalledWith(campModule, svc);
            expect(campModule.contentHost).toBe('foo.com');
            expect(campModule.campsCfg).toEqual({statusDelay: 100, statusAttempts: 5});
            
            expect(svc instanceof CrudSvc).toBe(true);
            expect(svc._prefix).toBe('cam');
            expect(svc.objName).toBe('campaigns');
            expect(svc._userProp).toBe(false);
            expect(svc._orgProp).toBe(false);
            expect(svc._allowPublic).toBe(false);
            expect(svc._coll).toEqual({collectionName: 'campaigns'});
            expect(svc._advertColl).toEqual({collectionName: 'advertisers'});
            expect(svc._custColl).toEqual({collectionName: 'customers'});
            
            expect(svc.createValidator._required).toContain('advertiserId', 'customerId');
            expect(svc.editValidator._forbidden).toContain('advertiserId', 'customerId');
            ['cards', 'miniReels', 'categories'].forEach(function(key) {
                expect(svc.createValidator._formats[key]).toEqual(['string']);
                expect(svc.editValidator._formats[key]).toEqual(['string']);
            });
            expect(svc.createValidator._formats.miniReelGroups).toEqual(['object']);
            expect(svc.editValidator._formats.miniReelGroups).toEqual(['object']);

            expect(svc._middleware.read).toContain(svc.preventGetAll);
            expect(svc._middleware.create).toContain(campaignUtils.getAccountIds,
                campModule.createSponsoredCamps, campModule.createTargetCamps);
            expect(svc._middleware.edit).toContain(campaignUtils.getAccountIds, campModule.cleanSponsoredCamps,
                campModule.editSponsoredCamps, campModule.createSponsoredCamps, campModule.cleanTargetCamps,
                campModule.editTargetCamps, campModule.createTargetCamps);
            expect(svc._middleware.delete).toContain(campModule.deleteContent);
            expect(svc.formatOutput).toBe(campModule.formatOutput);
        });
    });
    
    describe('formatOutput', function() {
        it('should correctly format an object for the client', function() {
            spyOn(CrudSvc.prototype, 'formatOutput').andCallThrough();
            var campaign = {
                _id: 'ekejrh', id: 'cam-1', name: 'camp 1', advertiserId: 'a-1', customerId: 'cu-1',
                cards: [{id: 'rc-1', adtechId: 12}, {id: 'rc-2', adtechId: 23}],
                miniReels: [{id: 'e-1', adtechId: 34}, {id: 'e-2', adtechId: 45}],
                miniReelGroups: [
                    { adtechId: 1234, cards: ['rc-1', 'rc-2'], miniReels: [{id: 'e-11', adtechId: 56}, {id: 'e-12', adtechId: 67}] },
                    { adtechId: 4567, cards: ['rc-1'] },
                ]
            };
            
            expect(campModule.formatOutput('mockSvc', campaign)).toEqual({
                id: 'cam-1', name: 'camp 1', advertiserId: 'a-1', customerId: 'cu-1',
                cards: ['rc-1', 'rc-2'],
                miniReels: ['e-1', 'e-2'],
                miniReelGroups: [
                    { adtechId: 1234, cards: ['rc-1', 'rc-2'], miniReels: ['e-11', 'e-12'] },
                    { adtechId: 4567, cards: ['rc-1'] }
                ]
            });
            
            expect(CrudSvc.prototype.formatOutput).toHaveBeenCalledWith(campaign);
        });
    });
    
    describe('cleanSponsoredCamps', function() {
        beforeEach(function() {
            req.params.id = 'cam-1';
            req.body = { miniReels: ['e-1', 'e-3'], cards: ['rc-2', 'rc-3'] };
            req.origObj = { miniReels: [{id: 'e-1', adtechId: 11}, {id: 'e-2', adtechId: 12}],
                            cards: [{id: 'rc-1', adtechId: 21}, {id: 'rc-2', adtechId: 22}] };
            spyOn(campModule, 'sendDeleteRequest').andReturn(q());
        });
        
        it('should delete unused campaigns', function(done) {
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).toEqual([{id: 'e-1'}, {id: 'e-3'}]);
                expect(req.body.cards).toEqual([{id: 'rc-2'}, {id: 'rc-3'}]);
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([12, 21], 1000, 10);
                expect(campModule.sendDeleteRequest.calls.length).toBe(2);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experience');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                done();
            });
        });
        
        it('should skip a list if it is not defined in req.body', function(done) {
            delete req.body.miniReels;
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).not.toBeDefined();
                expect(req.body.cards).toEqual([{id: 'rc-2'}, {id: 'rc-3'}]);
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([21], 1000, 10);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                done();
            });
        });
        
        it('should skip a list if not defined in req.origObj', function(done) {
            delete req.origObj.cards;
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([12], 1000, 10);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experience');
                done();
            });
        });
        
        it('should skip items that have no adtechId', function(done) {
            delete req.origObj.cards[0].adtechId;
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(mockLog.warn).toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([12], 1000, 10);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experience');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                done();
            });
        });

        it('should reject if deleting the campaigns fails', function(done) {
            campaignUtils.deleteCampaigns.andReturn(q.reject(new Error('ADTECH IS THE WORST')));
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('ADTECH IS THE WORST'));
                expect(campModule.sendDeleteRequest).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if one of the delete requests fails', function(done) {
            campModule.sendDeleteRequest.andReturn(q.reject(new Error('Request failed')));
            campModule.cleanSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('Request failed'));
                expect(campModule.sendDeleteRequest.calls.length).toBe(2);
                done();
            });
        });
    });
    
    describe('editSponsoredCamps', function() {
        beforeEach(function() {
            req.params.id = 'cam-1';
            req.body = { categories: ['food', 'sports'], miniReels: ['e-1', 'e-3'] };
            req.origObj = { categories: ['food'], miniReels: [{id: 'e-1', adtechId: 11}, {id: 'e-2', adtechId: 12}],
                                                  cards: [{id: 'rc-1', adtechId: 21}, {id: 'rc-2', adtechId: 22}] };
        });
        
        it('should edit existing campaigns if the categories are different', function(done) {
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels.calls.length).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level3: ['food', 'sports']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['food', 'sports']});
                expect(campaignUtils.editCampaign.calls.length).toBe(3);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith(11, null, {level3: [anyNum, anyNum]});
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith(21, null, {level1: [anyNum], level3: [anyNum, anyNum]});
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith(22, null, {level1: [anyNum], level3: [anyNum, anyNum]});
                done();
            });
        });
        
        it('should do nothing if the categories are the same', function(done) {
            req.origObj.categories = ['sports', 'food'];
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip a list if it does not exist on the original document', function(done) {
            delete req.origObj.miniReels;
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels.calls.length).toBe(1);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['food', 'sports']});
                expect(campaignUtils.editCampaign.calls.length).toBe(2);
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith(21, null, {level1: [anyNum], level3: [anyNum, anyNum]});
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith(22, null, {level1: [anyNum], level3: [anyNum, anyNum]});
                done();
            });
        });
        
        it('should reject if making the keywords fails', function(done) {
            campaignUtils.makeKeywords.andCallFake(function(keywords) {
                if (keywords && keywords[0] === 'food') return q.reject(new Error('I GOT A PROBLEM'));
                else return q(keywords);
            });
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if updating a campaign fails', function(done) {
            campaignUtils.editCampaign.andCallFake(function(id, name, keys) {
                if (id === 21) return q.reject(new Error('I GOT A PROBLEM'));
                else return q();
            });
            campModule.editSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.editCampaign.calls.length).toBe(3);
                done();
            });
        });
    });
    
    describe('createSponsoredCamps', function() {
        beforeEach(function() {
            req.body = { id: 'cam-1', categories: ['food'], miniReels: ['e-1'], cards: ['rc-1', 'rc-2'] };
            req.origObj = { id: 'cam-1', categories: ['sports'], miniReels: [{id: 'e-3', adtechId: 11}],
                                                                 cards: [{id: 'rc-2', adtechId: 21}] };
        });
        
        it('should create sponsored card and minireel campaigns', function(done) {
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).toEqual([{id: 'e-1', adtechId: 1000}]);
                expect(req.body.cards).toEqual([{id: 'rc-1', adtechId: 2000}, {id: 'rc-2', adtechId: 21}]);
                expect(campaignUtils.makeKeywordLevels.calls.length).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level3: ['food']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['food']});
                expect(campaignUtils.createCampaign.calls.length).toBe(2);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith('e-1', 'cam-1_miniReel_e-1', true,
                    {level3: [anyNum]}, 987, 876);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith('rc-1', 'cam-1_card_rc-1', true,
                    {level1: [anyNum], level3: [anyNum]}, 987, 876);
                expect(bannerUtils.createBanners.calls.length).toBe(2);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'e-1', adtechId: 1000}], null, 'miniReel', 1000);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'rc-1', adtechId: 2000}], null, 'card', 2000);
                done();
            });
        });
        
        it('should handle a missing original object', function(done) {
            delete req.origObj;
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).toEqual([{id: 'e-1', adtechId: 1000}]);
                expect(req.body.cards).toEqual([{id: 'rc-1', adtechId: 2000}, {id: 'rc-2', adtechId: 3000}]);
                expect(campaignUtils.makeKeywordLevels.calls.length).toBe(2);
                expect(campaignUtils.createCampaign.calls.length).toBe(3);
                expect(bannerUtils.createBanners.calls.length).toBe(3);
                done();
            });
        });
        
        it('should use the origObj\'s categories if not defined on req.body', function(done) {
            delete req.body.categories;
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level3: ['sports']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['sports']});
                done();
            });
        });

        it('should skip one of the lists if not defined on req.body', function(done) {
            delete req.body.miniReels;
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReels).not.toBeDefined();
                expect(campaignUtils.makeKeywordLevels.calls.length).toBe(1);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['cam-1'], level3: ['food']});
                expect(campaignUtils.createCampaign.calls.length).toBe(1);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith('rc-1', 'cam-1_card_rc-1', true,
                    {level1: [anyNum], level3: [anyNum]}, 987, 876);
                expect(bannerUtils.createBanners.calls.length).toBe(1);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'rc-1', adtechId: 1000}], null, 'card', 1000);
                done();
            });
        });
        
        it('should reject if making the keywords fails', function(done) {
            campaignUtils.makeKeywords.andCallFake(function(keywords) {
                if (keywords && keywords[0] === 'food') return q.reject(new Error('I GOT A PROBLEM'));
                else return q(keywords);
            });
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.createBanners).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if creating a campaign fails', function(done) {
            campaignUtils.createCampaign.andCallFake(function(id) {
                if (id === 'e-1') return q.reject(new Error('I GOT A PROBLEM'));
                else return q({id: String(this.createCampaign.calls.length*1000)});
            });
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign.calls.length).toBe(2);
                expect(bannerUtils.createBanners.calls.length).toBe(1);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'rc-1', adtechId: 2000}], null, 'card', 2000);
                done();
            });
        });
        
        it('should reject if creating banners fails', function(done) {
            bannerUtils.createBanners.andCallFake(function(newList, oldList, type, adtechId) {
                if (type === 'card') return q.reject(new Error('I GOT A PROBLEM'));
                else return q();
            });
            campModule.createSponsoredCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign.calls.length).toBe(2);
                expect(bannerUtils.createBanners.calls.length).toBe(2);
                done();
            });
        });
    });

    describe('cleanTargetCamps', function() {
        beforeEach(function() {
            req.params.id = 'cam-1';
            req.body = { miniReelGroups: [{adtechId: 11, cards: ['rc-1'], miniReels: ['e-1']},
                                          {adtechId: 12, cards: ['rc-2'], miniReels: ['e-2']}] };
            req.origObj = { miniReelGroups: [{adtechId: 21, cards: ['rc-1'], miniReels: ['e-1']},
                                             {adtechId: 12, cards: ['rc-2'], miniReels: ['e-2']},
                                             {adtechId: 22, cards: ['rc-3'], miniReels: ['e-3']}] };
        });
        
        it('should delete unused target group campaigns', function(done) {
            campModule.cleanTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([21, 22], 1000, 10);
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip objects if they have no adtechId', function(done) {
            delete req.origObj.miniReelGroups[0].adtechId;
            campModule.cleanTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([22], 1000, 10);
                expect(mockLog.warn).toHaveBeenCalled();
                done();
            });
        });
        
        it('should do nothing if the body or origObj has no miniReelGroups property', function(done) {
            req1 = { params: req.params, body: req.body, origObj: {} };
            req2 = { params: req.params, body: {}, origObj: req.origObj };
            campModule.cleanTargetCamps(req1, nextSpy, doneSpy).catch(errorSpy);
            campModule.cleanTargetCamps(req2, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).not.toHaveBeenCalled();
                expect(mockLog.warn).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if deleteCampaigns fails', function(done) {
            campaignUtils.deleteCampaigns.andReturn(q.reject(new Error('I GOT A PROBLEM')));
            campModule.cleanTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                done();
            });
        });
    });
    
    describe('editTargetCamps', function() {
        beforeEach(function() {
            req.params.id = 'cam-1';
            req.body = { miniReelGroups: [{adtechId: 11, cards: ['rc-1'], miniReels: ['e-1']},
                                          {adtechId: 12, cards: ['rc-2'], miniReels: ['e-2']},
                                          {adtechId: 13, cards: ['rc-3', 'rc-33'], miniReels: ['e-3']}] };
            req.origObj = { miniReelGroups: [{adtechId: 21, cards: ['rc-1'], miniReels: [{id: 'e-1'}]},
                                             {adtechId: 12, cards: ['rc-2'], miniReels: [{id: 'e-2'}]},
                                             {adtechId: 13, cards: ['rc-33', 'rc-3'], miniReels: [{id: 'e-4'}]}] };
        });

        it('should edit banner lists of existing target group campaigns', function(done) {
            campModule.editTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReelGroups).toEqual([{adtechId: 11, cards: ['rc-1'], miniReels: [{id: 'e-1'}]},
                                                         {adtechId: 12, cards: ['rc-2'], miniReels: [{id: 'e-2'}]},
                                                         {adtechId: 13, cards: ['rc-3', 'rc-33'], miniReels: [{id: 'e-3'}]}]);
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.cleanBanners.calls.length).toBe(2);
                expect(bannerUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-2'}], [{id: 'e-2'}], 12);
                expect(bannerUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-3'}], [{id: 'e-4'}], 13);
                expect(bannerUtils.createBanners.calls.length).toBe(2);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'e-2'}], [{id: 'e-2'}], 'contentMiniReel', 12);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'e-3'}], [{id: 'e-4'}], 'contentMiniReel', 13);
                done();
            });
        });
        
        it('should also edit a campaign if its cards list has changed', function(done) {
            req.body.miniReelGroups[1].cards.push('rc-22');
            campModule.editTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['rc-2', 'rc-22']});
                expect(campaignUtils.editCampaign).toHaveBeenCalledWith(12, null, {level1: [100, 200]});
                expect(bannerUtils.cleanBanners.calls.length).toBe(2);
                expect(bannerUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-2'}], [{id: 'e-2'}], 12);
                expect(bannerUtils.cleanBanners).toHaveBeenCalledWith([{id: 'e-3'}], [{id: 'e-4'}], 13);
                expect(bannerUtils.createBanners.calls.length).toBe(2);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'e-2'}], [{id: 'e-2'}], 'contentMiniReel', 12);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'e-3'}], [{id: 'e-4'}], 'contentMiniReel', 13);
                done();
            });
        });

        it('should do nothing if the body or origObj has no miniReelGroups property', function(done) {
            req1 = { params: req.params, body: req.body, origObj: {} };
            req2 = { params: req.params, body: {}, origObj: req.origObj };
            campModule.editTargetCamps(req1, nextSpy, doneSpy).catch(errorSpy);
            campModule.editTargetCamps(req2, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.cleanBanners).not.toHaveBeenCalled();
                expect(bannerUtils.createBanners).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if making keywords fails', function(done) {
            req.body.miniReelGroups[1].cards.push('rc-22');
            campaignUtils.makeKeywords.andReturn(q.reject('ADTECH IS THE WORST'));
            campModule.editTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.editCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.cleanBanners.calls.length).toBe(1);
                expect(bannerUtils.createBanners.calls.length).toBe(1);
                done();
            });
        });

        it('should reject if editing a campaign fails', function(done) {
            req.body.miniReelGroups[1].cards.push('rc-22');
            campaignUtils.editCampaign.andReturn(q.reject('ADTECH IS THE WORST'));
            campModule.editTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.editCampaign).toHaveBeenCalled();
                expect(bannerUtils.cleanBanners.calls.length).toBe(1);
                expect(bannerUtils.createBanners.calls.length).toBe(1);
                done();
            });
        });

        it('should reject if cleaning banners fails', function(done) {
            bannerUtils.cleanBanners.andCallFake(function(oldList, newList, id) {
                if (id === 12) return q.reject('ADTECH IS THE WORST');
                else return q();
            });
            campModule.editTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(bannerUtils.cleanBanners.calls.length).toBe(2);
                expect(bannerUtils.createBanners.calls.length).toBe(1);
                done();
            });
        });

        it('should reject if creating banners fails', function(done) {
            bannerUtils.createBanners.andCallFake(function(oldList, newList, type, id) {
                if (adtechId === 13) return q.reject('ADTECH IS THE WORST');
                else return q();
            });
            campModule.editTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(bannerUtils.cleanBanners.calls.length).toBe(2);
                expect(bannerUtils.createBanners.calls.length).toBe(2);
                done();
            });
        });
    });
    
    describe('createTargetCamps', function() {
        beforeEach(function() {
            req.body = { id: 'cam-1', miniReelGroups: [{cards: ['rc-1'], miniReels: ['e-1', 'e-11']},
                                                       {adtechId: 12, cards: ['rc-2'], miniReels: ['e-2']},
                                                       {cards: ['rc-3', 'rc-33'], miniReels: ['e-3']}] };
            spyOn(uuid, 'createUuid').andCallFake(function() { return String(this.createUuid.calls.length*111); });
        });
        
        it('should create target campaigns for miniReelGroups without adtechIds', function(done) {
            campModule.createTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(req.body.miniReelGroups).toEqual([
                    {adtechId: 1000, cards: ['rc-1'], miniReels: [{id: 'e-1'}, {id: 'e-11'}]},
                    {adtechId: 12, cards: ['rc-2'], miniReels: ['e-2']},
                    {adtechId: 2000, cards: ['rc-3', 'rc-33'], miniReels: [{id: 'e-3'}]}
                ]);
                expect(campaignUtils.makeKeywordLevels.calls.length).toBe(2);
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['rc-1']});
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalledWith({level1: ['rc-3', 'rc-33']});
                expect(campaignUtils.createCampaign.calls.length).toBe(2);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith('cam-1', 'cam-1_group_111', false, {level1: [100]}, 987, 876);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith('cam-1', 'cam-1_group_222', false, {level1: [200, 300]}, 987, 876);
                expect(bannerUtils.createBanners.calls.length).toBe(2);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'e-1'}, {id: 'e-11'}], null, 'contentMiniReel', 1000);
                expect(bannerUtils.createBanners).toHaveBeenCalledWith([{id: 'e-3'}], null, 'contentMiniReel', 2000);
                done();
            });
        });

        it('should be able to take the id from the origObj if not on the body', function(done) {
            delete req.body.id;
            req.origObj = { id: 'cam-2' };
            campModule.createTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.createCampaign.calls.length).toBe(2);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith('cam-2', 'cam-2_group_111', false, {level1: [100]}, 987, 876);
                expect(campaignUtils.createCampaign).toHaveBeenCalledWith('cam-2', 'cam-2_group_222', false, {level1: [200, 300]}, 987, 876);
                done();
            });
        });
        
        it('should do nothing if there are no miniReelGroups', function(done) {
            req1 = { body: { id: 'cam-1' } };
            req2 = { body: { id: 'cam-1', miniReelGroups: [] } };
            campModule.createTargetCamps(req1, nextSpy, doneSpy).catch(errorSpy);
            campModule.createTargetCamps(req2, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.createCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.createBanners).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should skip groups without cards or miniReels', function(done) {
            delete req.body.miniReelGroups[0].cards;
            req.body.miniReelGroups[2].miniReels = [];
            campModule.createTargetCamps(req1, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).not.toHaveBeenCalled();
                expect(campaignUtils.createCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.createBanners).not.toHaveBeenCalled();
                done();
            });
        });
        
        it('should reject if making keywords fails', function(done) {
            campaignUtils.makeKeywords.andReturn(q.reject('ADTECH IS THE WORST'));
            campModule.createTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.makeKeywordLevels).toHaveBeenCalled();
                expect(campaignUtils.createCampaign).not.toHaveBeenCalled();
                expect(bannerUtils.createBanners).not.toHaveBeenCalled();
                done();
            });
        });

        it('should reject if creating a campaign fails', function(done) {
            campaignUtils.createCampaign.andCallFake(function(id, name) {
                if (name.match('111')) return q.reject('ADTECH IS THE WORST');
                else return q({id: String(this.createCampaign.calls.length*1000)});
            });
            campModule.createTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign.calls.length).toBe(2);
                expect(bannerUtils.createBanners.calls.length).toBe(1);
                done();
            });
        });
        
        it('should reject if creating banners fails', function(done) {
            bannerUtils.createBanners.andCallFake(function(oldList, newList, type, adtechId) {
                if (adtechId === 2000) return q.reject('ADTECH IS THE WORST');
                else return q();
            });
            campModule.createTargetCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('Adtech failure');
                expect(mockLog.error).toHaveBeenCalled();
                expect(campaignUtils.createCampaign.calls.length).toBe(2);
                expect(bannerUtils.createBanners.calls.length).toBe(2);
                done();
            });
        });
    });

    describe('sendDeleteRequest', function() {
        var resp;
        beforeEach(function() {
            req.protocol = 'https';
            req.headers = { cookie: { c6Auth: 'qwer1234' } };
            resp = { response: { statusCode: 204 } };
            spyOn(requestUtils, 'qRequest').andCallFake(function() { return q(resp); });
        });
        
        it('should send a delete request to the content service', function(done) {
            campModule.sendDeleteRequest(req, 'e-1', 'experience').then(function() {
                expect(requestUtils.qRequest).toHaveBeenCalledWith('delete', {headers: {cookie: {c6Auth: 'qwer1234'}},
                    url: 'https://test.com/api/content/experience/e-1'});
                expect(mockLog.warn).not.toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should just log a warning if the statusCode is not 204', function(done) {
            resp = { response: { statusCode: 400 }, body: 'Unauthorized' };
            campModule.sendDeleteRequest(req, 'e-1', 'experience').then(function() {
                expect(mockLog.warn).toHaveBeenCalled();
                expect(mockLog.error).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });

        it('should reject if the request fails', function(done) {
            requestUtils.qRequest.andReturn(q.reject('I GOT A PROBLEM'));
            campModule.sendDeleteRequest(req, 'e-1', 'experience').then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('Failed sending delete request to content service'));
                expect(mockLog.error).toHaveBeenCalled();
            }).done(done);
        });
    });
    
    describe('deleteContent', function() {
        beforeEach(function() {
            req.origObj = { cards: [{id: 'rc-1'}], miniReels: [{id: 'e-1'}, {id: 'e-2'}],
                miniReelGroups: [{adtechId: 11, cards: ['rc-2'], miniReels: [{id: 'e-3'}]}] };
            spyOn(campModule, 'sendDeleteRequest').andReturn(q());
        });
        
        it('should delete all sponsored content for the campaign', function(done) {
            campModule.deleteContent(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest.calls.length).toBe(3);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-1', 'experience');
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'e-2', 'experience');
                done();
            });
        });
        
        it('should handle skip a list if not defined', function(done) {
            delete req.origObj.miniReels;
            campModule.deleteContent(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campModule.sendDeleteRequest.calls.length).toBe(1);
                expect(campModule.sendDeleteRequest).toHaveBeenCalledWith(req, 'rc-1', 'card');
                done();
            });
        });
        
        it('should reject if one of the requests rejects', function(done) {
            campModule.sendDeleteRequest.andCallFake(function(req, id, type) {
                if (id === 'e-1') return q.reject('YOU DONE FUCKED UP');
                else return q();
            });
            campModule.deleteContent(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith('YOU DONE FUCKED UP');
                expect(campModule.sendDeleteRequest.calls.length).toBe(3);
                done();
            });
        });
    });
    
    describe('deleteAdtechCamps', function() {
        beforeEach(function() {
            req.origObj = { cards: [{id: 'rc-1', adtechId: 11}], miniReels: [{id: 'e-1', adtechId: 21}, {id: 'e-2', adtechId: 22}],
                            miniReelGroups: [{adtechId: 31, cards: ['rc-2'], miniReels: [{id: 'e-3'}]},
                                             {adtechId: 32, cards: ['rc-2'] }] };
        });

        it('should delete all adtech campaigns', function(done) {
            campModule.deleteAdtechCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([11, 21, 22, 31, 32], 1000, 10);
                done();
            });
        });
        
        it('should skip a list if not defined', function(done) {
            delete req.origObj.miniReelGroups;
            campModule.deleteAdtechCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([11, 21, 22], 1000, 10);
                done();
            });
        });
        
        it('should skip items if they do not have an adtechId', function(done) {
            delete req.origObj.miniReels[0].adtechId;
            req.origObj.cards.push({id: 'rc-2'});
            campModule.deleteAdtechCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).not.toHaveBeenCalled();
                expect(campaignUtils.deleteCampaigns).toHaveBeenCalledWith([11, 22, 31, 32], 1000, 10);
                done();
            });
        });
        
        it('should reject if deleting the campaigns fails', function(done) {
            campaignUtils.deleteCampaigns.andReturn(q.reject(new Error('ADTECH IS THE WORST')));
            campModule.deleteAdtechCamps(req, nextSpy, doneSpy).catch(errorSpy);
            process.nextTick(function() {
                expect(nextSpy).not.toHaveBeenCalled();
                expect(doneSpy).not.toHaveBeenCalled();
                expect(errorSpy).toHaveBeenCalledWith(new Error('ADTECH IS THE WORST'));
                done();
            });
        });
    });
});
