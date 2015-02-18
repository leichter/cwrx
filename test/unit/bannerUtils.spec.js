var flush = true;
describe('bannerUtils', function() {
    var q, path, fs, mockLog, logger, adtech, bannerUtils, mockClient;
    
    beforeEach(function() {
        jasmine.Clock.useMock();

        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        q               = require('q');
        path            = require('path');
        fs              = require('fs-extra');
        logger          = require('../../lib/logger');
        bannerUtils   = require('../../lib/bannerUtils');
        
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
        
        mockClient = {client: 'yes'};
        delete require.cache[require.resolve('adtech/lib/banner')];
        adtech = require('adtech');
        adtech.bannerAdmin = require('adtech/lib/banner');
        Object.keys(adtech.bannerAdmin).forEach(function(prop) {
            if (typeof adtech.bannerAdmin[prop] !== 'function') {
                return;
            }
            adtech.bannerAdmin[prop] = adtech.bannerAdmin[prop].bind(adtech.bannerAdmin, mockClient);
            spyOn(adtech.bannerAdmin, prop).andCallThrough();
        });
    });

    describe('formatBanners', function() {
        var cardTempl, reelTempl;
        beforeEach(function() {
            cardTempl = fs.readFileSync(path.join(__dirname, '../../templates/adtechBanners/card.html'));
            reelTempl = fs.readFileSync(path.join(__dirname, '../../templates/adtechBanners/minireel.html'));
        });

        it('should format a banner for saving to adtech', function() {
            var obj = bannerUtils.formatBanner('card', 'rc-1');
            expect(obj).toEqual({ banner: jasmine.any(Object), bannerInfo: jasmine.any(Object) });
            expect(obj.banner).toEqual({
                data: cardTempl.toString('base64'), extId: 'rc-1', fileType: 'html', id: -1, mainFileName: 'index.html',
                name: 'card rc-1', originalData: cardTempl.toString('base64'), sizeTypeId: 277, statusId: 1, styleTypeId: 3 });
            expect(obj.bannerInfo).toEqual({
                bannerReferenceId: -1, entityFrequencyConfig: { frequencyCookiesOnly: true, frequencyDistributed: true,
                frequencyInterval: 30, frequencyTypeId: 18 }, name: 'card rc-1', statusId: 1 });
        });
        
        it('should correctly handle different banner types', function() {
            var banners = {};
            ['card', 'miniReel', 'contentMiniReel'].forEach(function(type) {
                banners[type] = bannerUtils.formatBanner(type, 'rc-1');
                if (type === 'card') expect(banners[type].banner.data).toBe(cardTempl.toString('base64'));
                else expect(banners[type].banner.data).toBe(reelTempl.toString('base64'));
                expect(banners[type].banner.originalData).toBe(banners[type].banner.data);
                expect(banners[type].banner.name).toBe(type + ' rc-1');
            });
            expect(banners.card.banner.sizeTypeId).toBe(277);
            expect(banners.miniReel.banner.sizeTypeId).toBe(509);
            expect(banners.contentMiniReel.banner.sizeTypeId).toBe(16);
        });
    });
    
    describe('createBanners', function() {
        var newBanns, oldBanns;
        beforeEach(function() {
            oldBanns = [];
            newBanns = [{id: 'rc-1'}, {id: 'rc-2'}];
            
            adtech.bannerAdmin.createBanner.andCallFake(function(campId, banner, bannerInfo) {
                var num = this.createBanner.calls.length;
                return q({name: banner.name, extId: banner.extId, bannerNumber: num, id: num*100});
            });
            spyOn(bannerUtils, 'formatBanner').andCallFake(function(type, id) {
                return {banner: {extId: id, name: type + ' ' + id}, bannerInfo: {name: type + ' ' + id}};
            });
        });
        
        it('should skip if the new banner list is not defined', function(done) {
            bannerUtils.createBanners(null, oldBanns, 'card', 12345).then(function(resp) {
                expect(adtech.bannerAdmin.createBanner).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should create a batch of banners', function(done) {
            bannerUtils.createBanners(newBanns, oldBanns, 'card', 12345).then(function(resp) {
                expect(newBanns).toEqual([
                    {id: 'rc-1', bannerId: 100, bannerNumber: 1},
                    {id: 'rc-2', bannerId: 200, bannerNumber: 2}
                ]);
                expect(bannerUtils.formatBanner).toHaveBeenCalledWith('card', 'rc-1');
                expect(bannerUtils.formatBanner).toHaveBeenCalledWith('card', 'rc-2');
                expect(adtech.bannerAdmin.createBanner.calls.length).toBe(2);
                expect(adtech.bannerAdmin.createBanner).toHaveBeenCalledWith(12345,
                    {extId: 'rc-1', name: 'card rc-1'}, {name: 'card rc-1'});
                expect(adtech.bannerAdmin.createBanner).toHaveBeenCalledWith(12345,
                    {extId: 'rc-2', name: 'card rc-2'}, {name: 'card rc-2'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should not recreate banners that already exist', function(done) {
            oldBanns = [
                { id: 'rc-2', bannerId: 200, bannerNumber: 2 },
                { id: 'rc-3', bannerId: 300, bannerNumber: 3 }
            ];
            bannerUtils.createBanners(newBanns, oldBanns, 'card', 12345).then(function() {
                expect(newBanns).toEqual([
                    {id: 'rc-1', bannerId: 100, bannerNumber: 1},
                    {id: 'rc-2', bannerId: 200, bannerNumber: 2}
                ]);
                expect(bannerUtils.formatBanner.calls.length).toBe(1);
                expect(bannerUtils.formatBanner).toHaveBeenCalledWith('card', 'rc-1');
                expect(adtech.bannerAdmin.createBanner.calls.length).toBe(1);
                expect(adtech.bannerAdmin.createBanner).toHaveBeenCalledWith(12345,
                    {extId: 'rc-1', name: 'card rc-1'}, {name: 'card rc-1'});
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if one of the adtech calls fails', function(done) {
            adtech.bannerAdmin.createBanner.andReturn(q.reject('I GOT A PROBLEM'));
            bannerUtils.createBanners(newBanns, oldBanns, 'card', 12345).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('I GOT A PROBLEM'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(bannerUtils.formatBanner.calls.length).toBe(2);
                expect(adtech.bannerAdmin.createBanner.calls.length).toBe(1);
            }).done(done);
        });
    });
    
    describe('cleanBanners', function() {
        var newBanns, oldBanns;
        beforeEach(function() {
            oldBanns = [
                { id: 'rc-2', bannerId: 200, bannerNumber: 2 },
                { id: 'rc-3', bannerId: 300, bannerNumber: 3 },
                { id: 'rc-4', bannerId: 400, bannerNumber: 4 }
            ];
            newBanns = [{id: 'rc-1'}, {id: 'rc-2'}];
            adtech.bannerAdmin.deleteBanner.andReturn(q());
        });
        
        it('should skip if either list is undefined', function(done) {
            q.all([
                bannerUtils.cleanBanners(null, oldBanns, 12345),
                bannerUtils.cleanBanners(newBanns, [], 12345)
            ]).then(function(results) {
                expect(adtech.bannerAdmin.deleteBanner).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should delete old banners not in the set of new banners', function(done) {
            bannerUtils.cleanBanners(newBanns, oldBanns, 12345).then(function() {
                expect(adtech.bannerAdmin.deleteBanner.calls.length).toBe(2);
                expect(adtech.bannerAdmin.deleteBanner).toHaveBeenCalledWith(300);
                expect(adtech.bannerAdmin.deleteBanner).toHaveBeenCalledWith(400);
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should do nothing if there are no old banners', function(done) {
            oldBanns = [];
            bannerUtils.cleanBanners(newBanns, oldBanns, 12345).then(function() {
                expect(adtech.bannerAdmin.deleteBanner).not.toHaveBeenCalled();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
            }).done(done);
        });
        
        it('should reject if one of the adtech calls fails', function(done) {
            adtech.bannerAdmin.deleteBanner.andReturn(q.reject('I GOT A PROBLEM'));
            bannerUtils.cleanBanners(newBanns, oldBanns, 12345).then(function() {
                expect('resolved').not.toBe('resolved');
            }).catch(function(error) {
                expect(error).toEqual(new Error('I GOT A PROBLEM'));
                expect(mockLog.error).toHaveBeenCalled();
                expect(adtech.bannerAdmin.deleteBanner.calls.length).toBe(1);
            }).done(done);
        });
    });
});