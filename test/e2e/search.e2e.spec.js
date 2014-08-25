var q               = require('q'),
    fs              = require('fs-extra'),
    path            = require('path'),
    testUtils       = require('./testUtils'),
    requestUtils    = require('../../lib/requestUtils'),
    request         = require('request'),
    host            = process.env['host'] || 'localhost',
    bucket          = process.env.bucket || 'c6.dev',
    config = {
        searchUrl   : 'http://' + (host === 'localhost' ? host + ':3800' : host) + '/api',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api'
    };

jasmine.getEnv().defaultTimeoutInterval = 30000;

describe('search (E2E):', function() {
    var cookieJar, mockUser;
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            return done();
        }
        cookieJar = require('request').jar();
        mockUser = {
            id: 'e2e-user',
            status: 'active',
            email : 'searche2euser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'e2e-org',
            permissions: {}
        };
        var loginOpts = {
            url: config.authUrl + '/auth/login',
            jar: cookieJar,
            json: { email: 'searche2euser', password: 'password' }
        };
        testUtils.resetCollection('users', mockUser).then(function(resp) {
            return requestUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
    
    describe('GET /api/search/videos', function() {
        var options;
        beforeEach(function() {
            options = {
                url: config.searchUrl + '/search/videos',
                qs: { query: 'cats' },
                jar: cookieJar
            };
        });

        it('should search for videos with a text query', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                resp.body.items.forEach(function(item) {
                    expect(item.title).toBeDefined();
                    expect(!!item.site.match(/^((youtube)|(vimeo)|(dailymotion))$/)).toBe(true);
                    expect(!!item.siteLink.match(item.site)).toBe(true);
                    expect(!!item.link.match(item.site)).toBe(true);
                    expect(item.hd).toBeDefined();
                    expect(item.videoid).toBeDefined();
                    expect(item.duration).toBeDefined();
                    expect(item.thumbnail).toBeDefined();
                    expect(item.thumbnail.src).toBeDefined();
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to restrict results to only hd videos', function(done) {
            options.qs.hd = 'true';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                resp.body.items.forEach(function(item) {
                    expect(item.title).toBeDefined();
                    expect(item.link).toBeDefined();
                    expect(item.hd).toBe(true);
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to restrict results to certain sites', function(done) {
            options.qs.sites = 'vimeo,dailymotion';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                resp.body.items.forEach(function(item) {
                    expect(!!item.site.match(/^((vimeo)|(dailymotion))$/)).toBe(true);
                    expect(!!item.siteLink.match(item.site)).toBe(true);
                    expect(!!item.link.match(item.site)).toBe(true);
                });
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should be able to paginate through results', function(done) {
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
                options.qs.skip = 10;
                options.qs.limit = 5;
                return requestUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(10);
                expect(resp.body.meta.numResults).toBe(5);
                expect(resp.body.meta.totalResults >= 15).toBeTruthy();
                expect(resp.body.items.length).toBe(5);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should impose sensible defaults on the skip and limit params', function(done) {
            options.qs.skip = '-3';
            options.qs.limit = '1000000000000000000';
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.meta).toBeDefined();
                expect(resp.body.meta.skipped).toBe(0);
                expect(resp.body.meta.numResults).toBe(10);
                expect(resp.body.meta.totalResults >= 10).toBeTruthy();
                expect(resp.body.items.length).toBe(10);
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 400 if no query is provided', function(done) {
            delete options.qs.query;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('No query in request');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
        
        it('should return a 401 if no user is logged in', function(done) {
            delete options.jar;
            requestUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
            }).catch(function(error) {
                expect(error).not.toBeDefined();
            }).finally(done);
        });
    });
});