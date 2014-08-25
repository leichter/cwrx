(function(){
    'use strict';

    var q       = require('q'),
        fs      = require('fs-extra'),
        request = require('request'),
        requestUtils = {};

    /**
     * Wrap the request module and return a promise. The promise is rejected if request gets an
     * error, the body has an error property, or if the status code is < 200 or >= 300.  Otherwise,
     * the promise is resolved with { response: {...}, body: {...} }.
     * files is an optional parameter - if specified, it should take the form { file1: path, ... },
     * and the request will read those files and append them as uploads.
     */
    requestUtils.qRequest = function(method, opts, files) {
        var deferred = q.defer();
        opts.method = method;
        
        var req = request(opts, function(error, response, body) {
            if (error) {
                return deferred.reject({error: error});
            }
            if (!response) {
                return deferred.reject({error: 'Missing response'});
            }
            body = body || '';
            try {
                body = JSON.parse(body);
            } catch(e) {}
            
            if (body.error) {
                return deferred.reject({code: response.statusCode, body: body});
            }
            deferred.resolve({response: response, body: body});
        });
        
        if (files && typeof files === 'object' && Object.keys(files).length > 0) {
            var form = req.form();
            Object.keys(files).forEach(function(key) {
                form.append(key, fs.createReadStream(files[key]));
            });
        }
        
        return deferred.promise;
    };
    
    module.exports = requestUtils;

}());