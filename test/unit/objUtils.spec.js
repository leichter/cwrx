var flush = true;
describe('objUtils', function() {
    var objUtils;
    
    beforeEach(function() {
        if (flush){ for (var m in require.cache){ delete require.cache[m]; } flush = false; }
        objUtils = require('../../lib/objUtils');
    });
   
    describe('sortObject', function() {
        it('should simply return the obj if not an object', function() {
            expect(objUtils.sortObject('abcd')).toBe('abcd');
            expect(objUtils.sortObject(10)).toBe(10);
        });
        
        it('should recursively sort an object by its keys', function() {
            var obj = {b: 1, a: 2, c: 5};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: 1, c: 5}));
            
            var obj = {b: {f: 3, e: 8}, a: 2, c: [3, 2, 1]};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: {e: 8, f: 3}, c: [3, 2, 1]}));
            
            var obj = {b: [{h: 1, g: 2}, {e: 5, f: 3}], a: 2};
            var sorted = objUtils.sortObject(obj);
            expect(JSON.stringify(sorted)).toBe(JSON.stringify({a: 2, b: [{g: 2, h: 1}, {e: 5, f: 3}]}));
        });
        
        it('should be able to handle null fields', function() {
            var obj = {b: 1, a: null}, sorted;
            expect(function() {sorted = objUtils.sortObject(obj);}).not.toThrow();
            expect(sorted).toEqual({a: null, b: 1});
        });
    });

    describe('compareObjects', function() {
        it('should perform a deep equality check on two objects', function() {
            var a = { foo: 'bar', arr: [1, 3, 2] }, b = { foo: 'bar', arr: [1, 2, 2] };
            expect(objUtils.compareObjects(a, b)).toBe(false);
            b.arr[1] = 3;
            expect(objUtils.compareObjects(a, b)).toBe(true);
            a.foo = 'baz';
            expect(objUtils.compareObjects(a, b)).toBe(false);
            a.foo = 'bar';
            a.data = { user: 'otter' };
            b.data = { user: 'otter', org: 'c6' };
            expect(objUtils.compareObjects(a, b)).toBe(false);
            a.data.org = 'c6';
            expect(objUtils.compareObjects(a, b)).toBe(true);
        });
    });

});