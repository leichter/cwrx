var request     = require('request'),
    q           = require('q'),
    path        = require('path'),
    fs          = require('fs-extra'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] ? process.env['host'] : 'localhost',
    statusHost  = process.env['statusHost'] ? process.env['statusHost'] : host,
    config      = {
        dubUrl: 'http://' + (host === 'localhost' ? host + ':3000' : host) + '/dub',
        maintUrl: 'http://' + (host === 'localhost' ? host + ':4000' : host) + '/maint',
        statusUrl: 'http://' + (statusHost === 'localhost' ? statusHost + ':3000' : statusHost) + '/dub/status/'
    },
    statusTimeout = 35000;

jasmine.getEnv().defaultTimeoutInterval = 40000;

describe('dub-light (E2E)', function() {
    var templateFile, templateJSON, siriTemplate,
        testNum = 0;
        
    beforeEach(function(done) {
        if (!process.env['getLogs']) return done();
        var options = {
            url: config.maintUrl + '/clear_log',
            json: {
                logFile: 'dub.log'
            }
        };
        request.post(options, function(error, response, body) {
            if (body && body.error) {
                console.log("Error clearing dub log: " + JSON.stringify(body));
            }
            done();
        });
    });
    afterEach(function(done) {
        if (!process.env['getLogs']) return done();
        testUtils.getLog('dub.log', maintUrl, jasmine.getEnv().currentSpec, ++testNum)
        .then(function() {
            done();
        }).catch(function(error) {
            console.log("Error getting log file for test " + testNum + ": " + JSON.stringify(error));
            done();
        });
    });
    
    beforeEach(function() {
        siriTemplate = {
            'video'   : 'siri_e2e.mp4',
            'tts'     : {
                'voice'  : 'Susan'
            },
            'script'  : [
	            { "ts": "6", "line": "new message from Josh. My head is stuck in the toaster.  Pick me up at the hospital after work." },
	            { "ts": "20", "line": "Clear. You can stop at the Taco Bell bathroom, to take a nasty poop." },
	            { "ts": "33", "line": "No, but CNN reports: <prosody pitch=\"high\"> hoe lee shit </prosody> a shark naydough." },
	            { "ts": "39.5", "line": "Better idea, sharks don't like wine." },
	            { "ts": "45", "line": "Hey jerk, stop bothering mee with dumb questions." },
	            { "ts": "51", "line": "Ok, I'll pretend like I'm doing that <Break time=\"750ms\"/> <prosody rate=\"slow\"> I hate you. </prosody>" }
            ],
            'e2e'     : {
                'md5': '4762fa45938d5f626b387d14bd23cf32'  // NOTE: if you change the 'script' section or the source video on S3, you will need to update this md5
            }
        };
    });

    describe('/dub/create', function() {
        it('should succeed with a valid slightly random template', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: siriTemplate
            };
            siriTemplate.script[Math.floor(Math.random() * siriTemplate.script.length)].line += Math.round(Math.random() * 10000);
            request.post(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                body = body || {};
                expect(body.error).not.toBeDefined();
                expect(body.output).toBeDefined();
                expect(typeof(body.output)).toEqual('string');
                expect(body.md5).not.toEqual(siriTemplate.e2e.md5);
                done();
            });
        });
        
        it('should succeed using API version 2', function(done) {
            var options = {
                url: config.dubUrl + '/create',
                json: siriTemplate 
            }, jobId, host;
            siriTemplate.version = 2;
            siriTemplate.script[Math.floor(Math.random() * siriTemplate.script.length)].line +=
                                Math.round(Math.random() * 10000);
            
            q.npost(request, 'post', [options])
            .then(function(values) {
                if (!values[1]) return q.reject('No body!');
                if (values[1].error) return q.reject(values[1].error);
                expect(values[0].statusCode).toBe(202);
                expect(values[1].jobId.match(/^\w{10}$/)).toBeTruthy();
                expect(values[1].host).toBeDefined();
                return testUtils.checkStatus(values[1].jobId, values[1].host, config.statusUrl, statusTimeout);
            }).then(function(resp) {
                expect(resp).toBeDefined();
                expect(resp.code).toBe(201);
                expect(resp.data).toBeDefined();
                expect(resp.data.lastStatus).toBeDefined();
                expect(resp.data.lastStatus.code).toBe(201);
                expect(resp.data.lastStatus.step).toBe('Completed');
                expect(resp.data.resultMD5).toBeDefined();
                expect(resp.data.resultUrl).toBeDefined();
                done();
            }).catch(function(error) {
                expect(error.toString()).not.toBeDefined();
                done();
            });
        });
    });
    
    describe('/dub/meta', function() {
        it('should print out appropriate metadata about the dub service', function(done) {
            var options = {
                url: config.dubUrl + '/meta'
            };
            request.get(options, function(error, response, body) {
                expect(error).toBeNull();
                expect(body).toBeDefined();
                var data = JSON.parse(body);
                expect(data.version).toBeDefined();
                expect(data.version.match(/^.+\.build\d+-\d+-g\w+$/)).toBeTruthy('version match');
                expect(data.config).toBeDefined();
                
                expect(data.config.hostname).toBeDefined();
                expect(data.config.proxyTimeout).toBeDefined();
                expect(data.config.responseTimeout).toBeDefined();
                
                expect(data.config.output).toBeDefined();
                expect(data.config.output.type).toBe('s3');
                expect(data.config.output.uri.match(/\/usr\/screenjack\/video/)).toBeTruthy();
                
                var bucket = process.env.bucket || 'c6.dev';
                var media = (bucket === 'c6.dev') ? 'media/' : '';
                expect(data.config.s3).toBeDefined();
                expect(data.config.s3.src).toBeDefined();
                expect(data.config.s3.src.bucket).toBe(bucket);
                expect(data.config.s3.src.path).toBe(media + 'src/screenjack/video');
                expect(data.config.s3.out.bucket).toBe(bucket);
                expect(data.config.s3.out.path).toBe(media + 'usr/screenjack/video');
                done();
            });
        });
    });  //  end -- describe /dub/meta
});  //  end -- describe dub-light (E2E)
