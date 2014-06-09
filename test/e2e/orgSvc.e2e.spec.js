var q           = require('q'),
    testUtils   = require('./testUtils'),
    host        = process.env['host'] || 'localhost',
    config      = {
        orgSvcUrl  : 'http://' + (host === 'localhost' ? host + ':3700' : host) + '/api/accounts',
        authUrl     : 'http://' + (host === 'localhost' ? host + ':3200' : host) + '/api/auth'
    };

describe('org (E2E):', function() {
    var cookieJar, mockRequester, noPermsUser;
        
    beforeEach(function(done) {
        if (cookieJar && cookieJar.cookies) {
            //return done();
        }
        cookieJar = require('request').jar();
        mockRequester = {
            id: 'e2e-user',
            status: 'active',
            email : 'orgSvcE2EUser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            permissions: {
                orgs: { read: 'all', create: 'all', edit: 'all', delete: 'all' }
            }
        };
        noPermsUser = {
            id: 'e2e-noPermsUser',
            status: 'active',
            email : 'orgSvcE2EnoPermsUser',
            password : '$2a$10$XomlyDak6mGSgrC/g1L7FO.4kMRkj4UturtKSzy6mFeL8QWOBmIWq', // hash of 'password'
            org: 'o-1234',
            permissions: {
                orgs: { read: 'own', create: 'own', edit: 'own', delete: 'own' }
            }
        };
        var loginOpts = {
            url: config.authUrl + '/login',
            jar: cookieJar,
            json: {
                email: 'orgSvcE2EUser',
                password: 'password'
            }
        };
        testUtils.resetCollection('users', [mockRequester, noPermsUser]).then(function(resp) {
            return testUtils.qRequest('post', loginOpts);
        }).done(function(resp) {
            done();
        });
    });
 
    afterEach(function(done) {
        var logoutOpts = {
            url: config.authUrl + '/logout',
            jar: cookieJar
        };
       testUtils.qRequest('post',logoutOpts)
        .done(function(){
            done();
        });
    });

    describe('GET /api/accounts/org/:id', function() {
        var mockOrg;
        beforeEach(function() {
            mockOrg = {
                id: 'o-1234',
                email: 'test',
                name: 'e2e-name1'
            };
        });
        
        it('should get an ord by id', function(done) {
            var options = { url: config.orgSvcUrl + '/org/o-1234', jar: cookieJar };
            testUtils.resetCollection('users', mockRequester)
            .then(testUtils.resetCollection('orgs', mockOrg))
            .then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).not.toEqual(mockOrg);
                expect(resp.body.id).toBe('o-1234');
                //expect(resp.body._id).not.toBeDefined();
                expect(resp.body.email).toBe('test');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should return a 404 if the requester cannot see the org', function(done) {
            var options = { url: config.orgSvcUrl + '/org/o-4567', jar: cookieJar };
            var logoutOpts = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: {
                    email: 'orgSvcE2EnoPermsUser',
                    password: 'password'
                }
            };
            mockOrg.id = 'o-4567';
            mockOrg.name = 'e2e-name2';
            testUtils.qRequest('post', logoutOpts)
            .then(function(){
                return testUtils.qRequest('post', loginOpts);
            })
            .then(function(){
                 return testUtils.resetCollection('orgs', mockOrg);
            })
            .then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No orgs found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should return a 404 if nothing is found', function(done) {
            var options = { url: config.orgSvcUrl + '/org/e2e-fake1', jar: cookieJar };
            testUtils.resetCollection('users', mockRequester).then(function() {
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No orgs found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/org/e2e-fake1' };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });
   
    describe('GET /api/account/orgs', function() {
        var mockOrgs;
        beforeEach(function(done) {
            mockOrgs = [
                { name: 'e2e-getOrg1', email: 'defg', id: 'o-1234' },
                { name: 'e2e-getOrg2', email: 'abcd', id: 'o-4567' },
                { name: 'e2e-getOrg3', email: 'hijk', id: 'o-7890' }
            ];
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
	        return testUtils.resetCollection('orgs', mockOrgs);
            })
            .done(done);
        });
        
        it('should get orgs', function(done) {
            var options = { url: config.orgSvcUrl + '/orgs', jar: cookieJar };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(3);
                //expect(resp.body[0]._id).not.toBeDefined();
                expect(resp.body[0].id).toBe('o-1234');
                expect(resp.body[0].email).toBe('defg');
                //expect(resp.body[1]._id).not.toBeDefined();
                expect(resp.body[1].id).toBe('o-4567');
                expect(resp.body[1].email).toBe('abcd');
                //expect(resp.body[2]._id).not.toBeDefined();
                expect(resp.body[2].id).toBe('o-7890');
                expect(resp.body[2].email).toBe('hijk');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should be able to sort and paginate the results', function(done) {
            var options = {
                url: config.orgSvcUrl + '/orgs?sort=email,1&limit=1',
                jar: cookieJar
            };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].name).toBe('e2e-getOrg2');
                expect(resp.body[0].email).toBe('abcd');
                options.url += '&skip=1';
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].name).toBe('e2e-getOrg1');
                expect(resp.body[0].email).toBe('defg');
                expect(resp.body[0].password).not.toBeDefined();
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not show orgs the requester cannot see', function(done) {
            var options = { url: config.orgSvcUrl + '/orgs', jar: cookieJar };
            var logoutOpts = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: {
                    email: 'orgSvcE2EnoPermsUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post',logoutOpts)
            .then(function(resp) {
                return testUtils.qRequest('post', loginOpts);
            })
            .then(function(){
                return testUtils.qRequest('get', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body).toBeDefined();
                expect(resp.body instanceof Array).toBeTruthy('body is array');
                expect(resp.body.length).toBe(1);
                expect(resp.body[0].id).toBe('o-1234');
                expect(resp.body[0].email).toBe('defg');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 404 error if no orgs are found', function(done) {
            var options = { url: config.orgSvcUrl + '/orgs', jar: cookieJar };
            testUtils.resetCollection('orgs')
            .then(function(){
                return testUtils.qRequest('get', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toEqual('No orgs found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/orgs' };
            testUtils.qRequest('get', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('POST /api/accounts/org', function() {
        var mockOrg;
        beforeEach(function(done) {
            mockOrg = {
                name: 'e2e-org',
                email: 'testPostOrg'
            };
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
                return testUtils.resetCollection('orgs', null);
            })
            .done(done);
        });
        
        it('should be able to create an org', function(done) {
            var options = { url: config.orgSvcUrl + '/org', json: mockOrg, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var newOrg = resp.body;
                expect(newOrg).toBeDefined();
                //expect(newOrg._id).not.toBeDefined();
                expect(newOrg.id).toBeDefined();
                expect(newOrg.email).toBe('testPostOrg');
                expect(new Date(newOrg.created).toString()).not.toEqual('Invalid Date');
                expect(newOrg.lastUpdated).toEqual(newOrg.created);
                expect(newOrg.name).toBe('e2e-org');
                expect(newOrg.status).toBe('active');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should be able to override default properties', function(done) {
            mockOrg.status = 'pending';
            var options = { url: config.orgSvcUrl + '/org', json: mockOrg, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                var newOrg = resp.body;
                expect(newOrg).toBeDefined();
                expect(newOrg.status).toBe('pending');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 error when trying to set forbidden properties', function(done) {
            mockOrg.id = 'o-1234';
            var options = { url: config.orgSvcUrl + '/org', json: mockOrg, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 error if the body is missing or incomplete', function(done) {
            var options = { url: config.orgSvcUrl + '/org', jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('You must provide an object in the body');
                options.json = { email: 'testPostOrg' };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('New org object must have a name');
                options.json = { name: 'e2e-org' };
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('New org object must have an email');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 409 error if a user with that name exists', function(done) {
            var options = { url: config.orgSvcUrl + '/org', json: mockOrg, jar: cookieJar };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(201);
                expect(resp.body).toBeDefined();
                return testUtils.qRequest('post', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(409);
                expect(resp.body).toBe('An org with that name already exists');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 403 error if the user is not authenticated for creating orgs', function(done) {
            var options = { url: config.orgSvcUrl + '/org', jar:cookieJar};
            var logoutOpts = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: {
                    email: 'orgSvcE2EnoPermsUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post',logoutOpts)
            .then(function(resp) {
                return testUtils.qRequest('post', loginOpts);
            })
            .then(function(){
                return testUtils.qRequest('post', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe("Not authorized to create orgs");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/org' };
            testUtils.qRequest('post', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

    });

    describe('PUT /api/accounts/org/:id', function() {
        var start = new Date(),
            mockOrgs, updates;
        beforeEach(function(done) {
            mockOrgs = [
                {
                    name: 'e2e-put1',
                    email: 'abcd',
                    id: 'o-1234',
                    tag: 'foo',
                    created: start
                },
                {
                    name: 'e2e-put2',
                    email: 'defg',
                    id: 'o-4567',
                    tag: 'baz',
                    created: start
                }
            ];
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
                return testUtils.resetCollection('orgs', mockOrgs);
            })
            .done(done);
            updates = { tag: 'bar' };
        });
        
        it('should successfully update an org', function(done) {
            var options = {
                url: config.orgSvcUrl + '/org/o-1234',
                json: updates,
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                var org = resp.body;
                expect(org._id).not.toBeDefined();
                expect(org.id).toBe('o-1234');
                expect(org.email).toBe('abcd');
                expect(org.tag).toBe('bar');
                expect(new Date(org.lastUpdated)).toBeGreaterThan(new Date(org.created));
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 404 if the org does not exist', function(done) {
            var options = {
                url: config.orgSvcUrl + '/org/org-fake',
                json: updates,
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('That org does not exist');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 403 if the requester is not authorized to edit the org', function(done) {
            var options = {
                url: config.orgSvcUrl + '/org/o-4567',
                json: updates,
                jar: cookieJar
            };
            var logoutOpts = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: {
                    email: 'orgSvcE2EnoPermsUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post',logoutOpts)
            .then(function(resp) {
                return testUtils.qRequest('post', loginOpts);
            }).then(function(){
                return testUtils.qRequest('put', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to edit this org');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });

        it('should throw a 400 if any of the update fields are illegal', function(done) {
            var options = {
                url: config.orgSvcUrl + '/org/o-1234',
                json: { created: 'new_created' },
                jar: cookieJar
            };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('Illegal fields');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org-fake' };
            testUtils.qRequest('put', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe('Unauthorized');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

    describe('DELETE /api/account/org/:id', function() {
        var mockOrgs;
        beforeEach(function(done) {
            mockOrgs = [
                { name: 'e2e-delete1', email: 'abcd', id: 'org1', status: 'active'},
                { name: 'e2e-delete2', email: 'defg', id: 'org2', status: 'active' },
                { name: 'e2e-delete3', email: 'ghij', id: 'o-1234', status: 'active' }
            ];
            testUtils.resetCollection('users', [mockRequester, noPermsUser])
            .then(function(){
                return testUtils.resetCollection('orgs', mockOrgs);
            })
            .done(done);
        });
        
        it('should successfully mark an org as deleted', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org1', jar: cookieJar };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.orgSvcUrl + '/org/e2e-delete1', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(404);
                expect(resp.body).toBe('No orgs found');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if the org does not exist', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org-fake', jar: cookieJar };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should still succeed if the org has already been deleted', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org1', jar: cookieJar };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                options = { url: config.orgSvcUrl + '/org/e2e-delete1', jar: cookieJar };
                return testUtils.qRequest('delete', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(204);
                expect(resp.body).toBe('');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should not allow a user to delete their own org', function(done) {
            var options = { url: config.orgSvcUrl + '/org/o-1234', jar: cookieJar };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(400);
                expect(resp.body).toBe('You cannot delete your own org');
                options = { url: config.orgSvcUrl + '/org/o-1234', jar: cookieJar };
                return testUtils.qRequest('get', options);
            }).then(function(resp) {
                expect(resp.response.statusCode).toBe(200);
                expect(resp.body.status).toBe('active');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
        
        it('should throw a 403 if the requester is not authorized to delete the org', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org2', jar: cookieJar };
            var logoutOpts = {
                url: config.authUrl + '/logout',
                jar: cookieJar
            };
            var loginOpts = {
                url: config.authUrl + '/login',
                jar: cookieJar,
                json: {
                    email: 'orgSvcE2EnoPermsUser',
                    password: 'password'
                }
            };
            testUtils.qRequest('post',logoutOpts)
            .then(function(resp) {
                return testUtils.qRequest('post', loginOpts);
            })
            .then(function(){
                return testUtils.qRequest('delete', options);
            })
            .then(function(resp) {
                expect(resp.response.statusCode).toBe(403);
                expect(resp.body).toBe('Not authorized to delete this org');
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    
        it('should throw a 401 error if the user is not authenticated', function(done) {
            var options = { url: config.orgSvcUrl + '/org/org-fake' };
            testUtils.qRequest('delete', options).then(function(resp) {
                expect(resp.response.statusCode).toBe(401);
                expect(resp.body).toBe("Unauthorized");
                done();
            }).catch(function(error) {
                expect(error).not.toBeDefined();
                done();
            });
        });
    });

});