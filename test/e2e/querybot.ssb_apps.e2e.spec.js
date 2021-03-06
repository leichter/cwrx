var q               = require('q'),
    util            = require('util'),
    request         = require('request'),
    isArray         = require('util').isArray,
    requestUtils    = require('../../lib/requestUtils'),
    testUtils       = require('./testUtils'),
    uuid            = require('rc-uuid'),
    host            = process.env.host || 'localhost',
    config = {
        querybotUrl : 'http://' + (host === 'localhost' ? host + ':4100' : host) +
            '/api/analytics/campaigns/showcase/apps',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) +
            '/api/auth'
    };

describe('querybot ssb_apps (E2E)', function(){
    var pgdata_campaign_summary_hourly,
        pgdata_unique_user_views_daily, pgdata_unique_user_views, 
        mockUser, mockCamps,
        cookieJar, options, camp1Data, camp2Data, camp5Data, 
        noDataCampData, mockApp, appCreds, today ;

    beforeEach(function(done){
        pgconn = {
            user    : 'cwrx',
            password: 'password',
            database: 'campfire_cwrx',
            host    : process.env.mongo ? JSON.parse(process.env.mongo).host : '33.33.33.100'
        };
        
        today = function(offset) {
            var dt = new Date(((new Date()).toISOString()).substr(0,10) + 'T00:00:00.000Z');
            return (new Date(dt.valueOf() + (86400000 * (offset || 0)))).toISOString().substr(0,10);
        };

        function initCampData(obj){
            var result = obj, i, dt;
            result.daily_7 = [];
            result.daily_30 = [];
            result.today = [];

            for (i = 30; i >= 1; i--){
                result.daily_30.push(
                    { date: today(i * -1), clicks: 0, installs: 0, launches: 0, users: 0, views: 0 }
                );
            }
            
            for (i = 7; i >= 1; i--){
                result.daily_7.push(
                    { date: today(i * -1), clicks: 0, installs: 0, launches: 0, users: 0, views: 0 }
                );
            }
            
            for (i = 0; i <= 23; i++){
                dt = today() + 'T' + ((i <10) ? '0' : '') + i + ':00:00.000Z';
                result.today.push(
                    { hour: dt, clicks: 0, installs: 0, launches: 0, users: 0, views: 0 }
                );
            }

            return result;
        }
        
        noDataCampData = initCampData({
            campaignId : 'cam-99999999999999',
            summary : {
                clicks :  0,
                installs: 0,
                launches: 0,
                users   : 0,
                views   : 0
            },
            cycle : {
                clicks :  0,
                installs: 0,
                launches: 0,
                users   : 0,
                views   : 0
            }
        });

        camp1Data = initCampData({
            campaignId : 'cam-1757d5cd13e383',
            summary : {
                clicks :  52,
                installs: 6,
                launches: 6984,
                users  : 310,
                views  : 376
            },
            cycle : {
                clicks :  26,
                installs: 3,
                launches: 3492,
                users   : 318,
                views   : 188
            }
        });
        camp1Data.daily_7[0].users = 348;
        camp1Data.daily_7[2].users = 338;
        camp1Data.daily_7[4].users = 328;
        camp1Data.daily_7[6].clicks = 26;
        camp1Data.daily_7[6].installs = 3;
        camp1Data.daily_7[6].launches = 3492;
        camp1Data.daily_7[6].users = 308;
        camp1Data.daily_7[6].views = 188;
        
        camp1Data.daily_30[17].users = 298;
        camp1Data.daily_30[18].users = 278;
        camp1Data.daily_30[19].users = 288;
        camp1Data.daily_30[20].users = 298;
        camp1Data.daily_30[21].users = 318;
        
        camp1Data.daily_30[23].users = 348;
        camp1Data.daily_30[25].users = 338;
        camp1Data.daily_30[27].users = 328;
        camp1Data.daily_30[29].clicks = 26;
        camp1Data.daily_30[29].installs = 3;
        camp1Data.daily_30[29].launches = 3492;
        camp1Data.daily_30[29].users = 308;
        camp1Data.daily_30[29].views = 188;
        
        camp1Data.today[0].views = 42; camp1Data.today[0].clicks = 9; camp1Data.today[0].users = 36;
            camp1Data.today[0].launches = 923;
        camp1Data.today[1].views = 55; camp1Data.today[1].clicks = 2; camp1Data.today[1].users = 51;
            camp1Data.today[1].launches = 913;
        camp1Data.today[2].views = 42; camp1Data.today[2].clicks = 6; camp1Data.today[2].users = 39;
            camp1Data.today[2].launches = 853;camp1Data.today[2].installs = 2;
        camp1Data.today[3].views = 49; camp1Data.today[3].clicks = 9; camp1Data.today[3].users = 29;
            camp1Data.today[3].launches = 803;camp1Data.today[3].installs = 1;
        
        camp2Data = initCampData({
            campaignId : 'cam-b651cde4158304',
            summary : {
                clicks :  16,
                installs: 3,
                launches: 24,
                users  : 694,
                views  : 716
            },
            cycle : {
                clicks :  0,
                installs: 0,
                launches: 0,
                users   : 0,
                views   : 0
            }
        });

        camp2Data.daily_7[0].users = 248;
        camp2Data.daily_7[2].users = 238;
        camp2Data.daily_7[4].users = 228;
        camp2Data.daily_7[5].views = 80;
        camp2Data.daily_7[5].launches = 12;
        camp2Data.daily_7[5].installs = 2;
        camp2Data.daily_7[5].clicks = 4;
        camp2Data.daily_7[6].users =208;
        camp2Data.daily_7[6].views = 100;
        camp2Data.daily_7[6].launches = 12;
        camp2Data.daily_7[6].installs = 1;
        camp2Data.daily_7[6].clicks = 2;

        camp2Data.daily_30[17].users =198;
        camp2Data.daily_30[18].users =178;
        camp2Data.daily_30[19].users =188;
        camp2Data.daily_30[20].users =198;
        camp2Data.daily_30[21].users =218;
        
        camp2Data.daily_30[23].users = 248;
        camp2Data.daily_30[25].users = 238;
        camp2Data.daily_30[27].users = 228;
        camp2Data.daily_30[28].views = 80;
        camp2Data.daily_30[28].launches = 12;
        camp2Data.daily_30[28].installs = 2;
        camp2Data.daily_30[28].clicks = 4;
        camp2Data.daily_30[29].users =208;
        camp2Data.daily_30[29].views = 100;
        camp2Data.daily_30[29].launches = 12;
        camp2Data.daily_30[29].installs = 1;
        camp2Data.daily_30[29].clicks = 2;
        
        camp2Data.today[0].views = 318; camp2Data.today[0].clicks = 2; camp2Data.today[0].users = 308;
        camp2Data.today[1].views = 218; camp2Data.today[1].clicks = 8; camp2Data.today[1].users = 208;
        
        camp5Data = initCampData({
            campaignId : 'cam-cabd93049d032a',
            summary : {
                views  : 189,
                users  : 179,
                clicks :  9,
                launches: 0,
                installs: 0
            },
            cycle : {
                clicks :  0,
                installs: 0,
                launches: 0,
                users   : 0,
                views   : 0
            }
        });
 
        pgdata_campaign_summary_hourly = [
            'INSERT INTO rpt.campaign_summary_hourly VALUES',
            '(\'' + today() + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',52,0.0000),',
            '(\'' + today() + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',42,0.4200),',
            '(\'' + today() + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'unique_user_view\',36,0.0000),',
            '(\'' + today() + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',9,0.0000),',
            '(\'' + today() + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'appLaunch\',923,0.0000),',
            
            '(\'' + today() + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',58,0.0000),',
            '(\'' + today() + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',55,0.5500),',
            '(\'' + today() + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'unique_user_view\',51,0.0000),',
            '(\'' + today() + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',2,0.0000),',
            '(\'' + today() + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'appLaunch\',913,0.0000),',
            
            '(\'' + today() + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',51,0.0000),',
            '(\'' + today() + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',42,0.4200),',
            '(\'' + today() + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'unique_user_view\',39,0.0000),',
            '(\'' + today() + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',6,0.0000),',
            '(\'' + today() + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'appLaunch\',853,0.0000),',
            '(\'' + today() + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'appInstall\',2,0.0000),',

            '(\'' + today() + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',53,0.0000),',
            '(\'' + today() + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',49,0.4900),',
            '(\'' + today() + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'unique_user_view\',29,0.0000),',
            '(\'' + today() + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',9,0.0000),',
            '(\'' + today() + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'appLaunch\',803,0.0000),',
            '(\'' + today() + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'appInstall\',1,0.0000),',
            
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',52,0.0000),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',42,0.4200),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'unique_user_view\',36,0.0000),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',9,0.0000),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-1757d5cd13e383\',\'appLaunch\',923,0.0000),',
            
            '(\'' + today(-1) + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',58,0.0000),',
            '(\'' + today(-1) + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',55,0.5500),',
            '(\'' + today(-1) + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'unique_user_view\',51,0.0000),',
            '(\'' + today(-1) + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',2,0.0000),',
            '(\'' + today(-1) + ' 01:00:00+00\',\'cam-1757d5cd13e383\',\'appLaunch\',913,0.0000),',
            
            '(\'' + today(-1) + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',51,0.0000),',
            '(\'' + today(-1) + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',42,0.4200),',
            '(\'' + today(-1) + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'unique_user_view\',39,0.0000),',
            '(\'' + today(-1) + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',6,0.0000),',
            '(\'' + today(-1) + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'appLaunch\',853,0.0000),',
            '(\'' + today(-1) + ' 02:00:00+00\',\'cam-1757d5cd13e383\',\'appInstall\',2,0.0000),',

            '(\'' + today(-1) + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'cardView\',53,0.0000),',
            '(\'' + today(-1) + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'completedView\',49,0.4900),',
            '(\'' + today(-1) + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'unique_user_view\',29,0.0000),',
            '(\'' + today(-1) + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'link.Action\',9,0.0000),',
            '(\'' + today(-1) + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'appLaunch\',803,0.0000),',
            '(\'' + today(-1) + ' 03:00:00+00\',\'cam-1757d5cd13e383\',\'appInstall\',1,0.0000),',


            '(\'' + today() + ' 00:00:00+00\',\'cam-b651cde4158304\',\'cardView\',385,0.0000),',
            '(\'' + today() + ' 00:00:00+00\',\'cam-b651cde4158304\',\'completedView\',318,34.9800),',
            '(\'' + today() + ' 00:00:00+00\',\'cam-b651cde4158304\',\'unique_user_view\',308,0.0000),',
            '(\'' + today() + ' 00:00:00+00\',\'cam-b651cde4158304\',\'link.Action\',2,0.0000),',

            '(\'' + today() + ' 01:00:00+00\',\'cam-b651cde4158304\',\'cardView\',285,0.0000),',
            '(\'' + today() + ' 01:00:00+00\',\'cam-b651cde4158304\',\'completedView\',218,34.9800),',
            '(\'' + today() + ' 01:00:00+00\',\'cam-b651cde4158304\',\'unique_user_view\',208,0.0000),',
            '(\'' + today() + ' 01:00:00+00\',\'cam-b651cde4158304\',\'link.Action\',8,0.0000),',

            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'cardView\',110,0.0000),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'completedView\',100,34.9800),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'unique_user_view\',100,0.0000),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'link.Action\',2,0.0000),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'appInstall\',1,0.0000),',
            '(\'' + today(-1) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'appLaunch\',12,0.0000),',

            '(\'' + today(-2) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'cardView\',100,0.0000),',
            '(\'' + today(-2) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'completedView\',80,34.9800),',
            '(\'' + today(-2) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'unique_user_view\',78,0.0000),',
            '(\'' + today(-2) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'link.Action\',4,0.0000),',
            '(\'' + today(-2) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'appInstall\',2,0.0000),',
            '(\'' + today(-2) + ' 00:00:00+00\',\'cam-b651cde4158304\',\'appLaunch\',12,0.0000),',

            '(\'' + today(-5) + ' 00:00:00+00\',\'cam-cabd93049d032a\',\'cardView\',199,0.0000),',
            '(\'' + today(-5) + ' 00:00:00+00\',\'cam-cabd93049d032a\',\'completedView\',189,9.4500),',
            '(\'' + today(-5) + ' 00:00:00+00\',\'cam-cabd93049d032a\',\'unique_user_view\',179,0.0000),',
            '(\'' + today(-5) + ' 00:00:00+00\',\'cam-cabd93049d032a\',\'link.Action\',9,0.0000);'
        ];

        pgdata_unique_user_views = [
            'INSERT INTO rpt.unique_user_views VALUES',
            '(\'cam-1757d5cd13e383\',310,\'2015-12-03 00:00:00+00\',\'2016-05-03 23:00:00+00\'),',
            '(\'cam-b651cde4158304\',694,\'2015-12-04 00:00:00+00\',\'2016-05-04 23:00:00+00\'),',
            '(\'cam-cabd93049d032a\',179,\'2015-12-05 00:00:00+00\',\'2016-05-05 23:00:00+00\');'
        ];

        pgdata_unique_user_views_daily = [
            'INSERT INTO rpt.unique_user_views_daily VALUES',
            '(\'' + today()    + '\',\'cam-1757d5cd13e383\',318),',
            '(\'' + today(-1)  + '\',\'cam-1757d5cd13e383\',308),',
            '(\'' + today(-3)  + '\',\'cam-1757d5cd13e383\',328),',
            '(\'' + today(-5)  + '\',\'cam-1757d5cd13e383\',338),',
            '(\'' + today(-7)  + '\',\'cam-1757d5cd13e383\',348),',
            '(\'' + today(-9)  + '\',\'cam-1757d5cd13e383\',318),',
            '(\'' + today(-10) + '\',\'cam-1757d5cd13e383\',298),',
            '(\'' + today(-11) + '\',\'cam-1757d5cd13e383\',288),',
            '(\'' + today(-12) + '\',\'cam-1757d5cd13e383\',278),',
            '(\'' + today(-13) + '\',\'cam-1757d5cd13e383\',298),',
            
            '(\'' + today()    + '\',\'cam-b651cde4158304\',218),',
            '(\'' + today(-1)  + '\',\'cam-b651cde4158304\',208),',
            '(\'' + today(-3)  + '\',\'cam-b651cde4158304\',228),',
            '(\'' + today(-5)  + '\',\'cam-b651cde4158304\',238),',
            '(\'' + today(-7)  + '\',\'cam-b651cde4158304\',248),',
            '(\'' + today(-9)  + '\',\'cam-b651cde4158304\',218),',
            '(\'' + today(-10) + '\',\'cam-b651cde4158304\',198),',
            '(\'' + today(-11) + '\',\'cam-b651cde4158304\',188),',
            '(\'' + today(-12) + '\',\'cam-b651cde4158304\',178),',
            '(\'' + today(-13) + '\',\'cam-b651cde4158304\',198);'
        ];

        mockUser = {
            id: 'e2e-user', org: 'e2e-org', status: 'active', email : 'querybot',
            // hash of 'password'
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', 
            permissions: {
                cards: { delete: 'org' },
                experiences: { delete: 'org' },
                campaigns: { read: 'org', create: 'org', edit: 'org', delete: 'own' }
            }
        };
        mockApp = {
            id: 'app-e2e-querybot',
            key: 'e2e-querybot',
            status: 'active',
            secret: 'wowsuchsecretverysecureamaze',
            permissions: {
                campaigns: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        appCreds = { key: mockApp.key, secret: mockApp.secret };
        
        mockCamps = [
            { id: 'cam-1757d5cd13e383', name: 'camp 1', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-b651cde4158304', name: 'camp 2', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-99999999999999', name: 'camp 2', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
            { id: 'cam-278b8150021c68', name: 'camp 3', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' },
            { id: 'e2e-getid3', name: 'camp 4', status: 'active',
                user: 'not-e2e-user', org: 'not-e2e-org' },
            { id: 'cam-cabd93049d032a', name: 'camp 5', status: 'active',
                user: 'e2e-user', org: 'e2e-org' },
        ];

        function pgTruncate(){
            return testUtils.pgQuery('TRUNCATE TABLE rpt.campaign_summary_hourly')
                .then(function(){
                    return testUtils.pgQuery('TRUNCATE TABLE rpt.unique_user_views');
                })
                .then(function(){
                    return testUtils.pgQuery('TRUNCATE TABLE rpt.unique_user_views_daily');
                })
                .then(function(){
                    return testUtils.pgQuery('TRUNCATE TABLE fct.billing_transactions');
                })
                .then(function(){
                    return testUtils.pgQuery('TRUNCATE TABLE fct.showcase_user_views_daily');
                });
        }

        function pgInsert() {
            return testUtils.pgQuery(pgdata_campaign_summary_hourly.join(' '))
                .then(function(){
                    return testUtils.pgQuery(pgdata_unique_user_views.join(' '));
                })
                .then(function(){
                    return testUtils.pgQuery(pgdata_unique_user_views_daily.join(' '));
                })
                .then(function(){
                    return testUtils.pgQuery('SELECT * FROM rpt.unique_user_views_daily')
                        .then(function(result){
                            var records = [], record, i, org ;
                            result.rows.forEach(function(row, i){
                                for (i = 0; i < row.unique_user_views; i++) {
                                    org = mockCamps.filter(function(c){
                                        return c.id === row.campaign_id;
                                    })[0].org;
                                    records.push( '(' + 
                                        '\'' + row.rec_date.toISOString().substr(0,10) + '\',' +
                                        '\'' + row.campaign_id + '\',' +
                                        '\'' + org + '\',' +
                                        '\'' + uuid.createUuid() + '\')'
                                    );
                                }
                            });
                            return testUtils.pgQuery(
                                'INSERT INTO fct.showcase_user_views_daily VALUES' +
                                records.join(',\n') + ';'
                            );
                        });
                })
                .then(function(){
                    var trans_date = today() + ' 12:00:00+00';
                    var sql = [ 
                        'INSERT INTO fct.billing_transactions(',
                            'rec_key,rec_ts,transaction_id,transaction_ts,',
                            'org_id,amount,sign,units,application)',
                            'VALUES (',
                            '1, current_timestamp, \'t-000\',\'' + trans_date + '\',',
                            '\'e2e-org\',1,1,1,\'showcase\');'
                    ];

                    return testUtils.pgQuery(sql.join(' '));
                });
        }

        function mongoInsert() {
            return q.all([
                testUtils.resetCollection('users', mockUser),
                testUtils.resetCollection('campaigns', mockCamps),
                testUtils.mongoUpsert('applications', { key: mockApp.key }, mockApp)
            ]);
        }

        pgTruncate().then(pgInsert).then(mongoInsert).then(done,done.fail);
    });

    beforeEach(function(done){
        if (cookieJar) {
            return done();
        }
        cookieJar = request.jar();

        requestUtils.qRequest('post', {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                email: 'querybot',
                password: 'password'
            }
        })
        .then(done,done.fail);
    });

    beforeEach(function(){
        options = {
            url : config.querybotUrl,
            jar : cookieJar
        };
    });

    describe('GET /api/analytics/campaigns/showcase/apps/:id', function() {
        describe('using transaction application to identify showcase',function(){
            it('requires authentication',function(done){
                delete options.jar;
                options.url += '/cam-1757d5cd13e383';
                requestUtils.qRequest('get', options)
                .then(function(resp) {
                    expect(resp.response.statusCode).toEqual(401);
                    expect(resp.response.body).toEqual('Unauthorized');
                })
                .then(done,done.fail);

            });

            // Uncomment when we support lookups with the campaignId in the query params
            //it('returns a 400 error if there is no campaignID',function(done){
            //    requestUtils.qRequest('get', options)
            //    .then(function(resp) {
            //        expect(resp.response.statusCode).toEqual(400);
            //        expect(resp.response.body).toEqual('At least one campaignId is required.');
            //    })
            //    .then(done,done.fail);
            //});

            it('returns a 404 if the campaignId is not found',function(done){
                options.url += '/cam-278b8150021c68';
                requestUtils.qRequest('get', options)
                .then(function(resp) {
                    expect(resp.response.statusCode).toEqual(404);
                    expect(resp.response.body).toEqual('Not Found');
                })
                .then(done,done.fail);
            });

            it('returns single doc with all data if the campaigns GET is singular',function(done){
                options.url += '/cam-1757d5cd13e383';
                requestUtils.qRequest('get', options)
                .then(function(resp) {
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual(camp1Data);
                })
                .then(done,done.fail);
            });
            
            it('should allow an app to get stats', function(done) {
                delete options.jar;
                options.url += '/cam-1757d5cd13e383';
                requestUtils.makeSignedRequest(appCreds, 'get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(200);
                    expect(resp.body).toEqual(camp1Data);
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('should fail if an app uses the wrong secret to make a request', function(done) {
                delete options.jar;
                options.url += '/cam-1757d5cd13e383';
                var badCreds = { key: mockApp.key, secret: 'WRONG' };
                requestUtils.makeSignedRequest(badCreds, 'get', options).then(function(resp) {
                    expect(resp.response.statusCode).toBe(401);
                    expect(resp.body).toBe('Unauthorized');
                }).catch(function(error) {
                    expect(util.inspect(error)).not.toBeDefined();
                }).done(done);
            });
            
            it('returns single doc with all data set to 0 if campaign has no data',function(done){
                options.url += '/cam-99999999999999';
                requestUtils.qRequest('get', options)
                .then(function(resp) {
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual(noDataCampData);
                })
                .then(done,done.fail);
            });
        });
        
        describe('using transaction description to identify showcase',function(){
            beforeEach(function(done){
                return testUtils.pgQuery('TRUNCATE TABLE fct.billing_transactions')
                .then(function(){
                    var trans_date = today() + ' 12:00:00+00';
                    var sql = [ 
                        'INSERT INTO fct.billing_transactions VALUES (',
                            '1, current_timestamp, \'t-000\',\'' + trans_date + '\',',
                            '\'e2e-org\',1,1,1,null,null,null,\'{ "target": "showcase" }\');'
                    ];

                    return testUtils.pgQuery(sql.join(' '));
                })
                .then(done,done.fail);
            });
            
            it('returns single doc with all data if the campaigns GET is singular',function(done){
                options.url += '/cam-1757d5cd13e383';
                requestUtils.qRequest('get', options)
                .then(function(resp) {
                    expect(resp.response.statusCode).toEqual(200);
                    expect(resp.body).toEqual(camp1Data);
                })
                .then(done,done.fail);
            });
        });
    });
});
