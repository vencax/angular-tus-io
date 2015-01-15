

// taken from https://github.com/23/resumable.js/blob/master/resumable.js
var support = ((typeof(File) !== 'undefined') && (typeof(Blob) !== 'undefined') &&
               (typeof(FileList)!=='undefined') &&
               (!!Blob.prototype.webkitSlice || !!Blob.prototype.mozSlice || !!Blob.prototype.slice || false)
              );

var MAXCHANKQSIZE = 8;

angular.module('tus.io', ['ng'])

.factory('BasicTUS', function($http, $q) {

  function BasicClient(file, options) {
    this.file = file;
    this.options = {
      // The tus upload endpoint url
      endpoint: options.endpoint,

      // The fingerprint for the file.
      // Uses our own fingerprinting if undefined.
      fingerprint: options.fingerprint,

      // @TODO: second option: resumable: true/false
      // false -> removes resume functionality
      resumable: options.resumable !== undefined ? options.resetBefore : true,
      headers: options.headers !== undefined ? options.headers : {},
      chunkSize: options.chunkSize
    };

    // The url of the uploaded file, assigned by the tus upload endpoint
    this.fileUrl = null;

    this.chunkQueue = [];

    this.slice = this.file.slice || this.file.webkitSlice || this.file.mozSlice;
    this.reader = new FileReader();

    // Bytes sent to the server so far
    this.bytesWritten = null;
    this.bytesEnqued = null;

    // Create a deferred and make our upload a promise object
    this._deferred = $q.defer();

    setTimeout(this._start.bind(this), 10);

    return this._deferred.promise;
  }

  // Creates a file resource at the configured tus endpoint and gets the url for it.
  BasicClient.prototype._start = function() {
    // Optionally resetBefore
    if (!this.options.resumable || this.options.resetBefore === true) {
      this._urlCache(false);
    }

    if (!(this.fileUrl = this._urlCache())) {
      this._post();
    } else {
      this._head();
    }
  };

  BasicClient.prototype._post = function() {
    var self = this;
    var headers = {
      'Final-Length': this.file.size
    };
    angular.extend(headers, this.options.headers);

    var req = {
      method: 'POST',
      url: this.options.endpoint,
      headers: headers,
      data: { test: 'test' },
    };

    $http(req).success(function(data, status, headers, config) {
      var location = headers('Location');
      if (!location) {
        return self._emitFail('Could not get url for file resource. ' + data);
      }

      self.fileUrl = location;
      self._uploadFile(0);
    }).error(function(data, status, headers, config) {
      // @todo: Implement retry support
      self._emitFail('Could not post to file resource ' +
        self.options.endpoint + '. ' + data);
    });
  };

  BasicClient.prototype._head = function() {
    var self = this;
    var req = {
      method: 'HEAD',
      url: this.fileUrl,
      cache: false,
      headers: this.options.headers
    };

    $http(req).success(function(data, status, headers, config) {
      var offset = headers('Offset');
      self._uploadFile(offset ? parseInt(offset, 10) : 0);
    }).error(function(data, status, headers, config) {
      // @TODO: Implement retry support
      if(status === 404){
        // not valid, not on server
        // start with post request and restart upload
        self._post();
      }else{
        self._emitFail('Could not head at file resource: ' + data);
      }
    });
  };

  // Uploads the file data to tus resource url created by _start()
  BasicClient.prototype._uploadFile = function(start) {

    this.bytesWritten = this.bytesEnqued = start;

    this._urlCache(this.fileUrl);

    this._onTimer();
  };

  BasicClient.prototype._onTimer = function() {

    if (this.bytesWritten === this.file.size) {
      // Cool, we already completely uploaded this.
      this._deferred.notify(self.bytesWritten); // Update progress to 100%.
      return this._emitDone();
    }

    this._fillChunkQueue();
    this._uploadChunk(this.chunkQueue);
  };

  BasicClient.prototype._fillChunkQueue = function(range_from) {
    var chStart = this.bytesEnqued;
    while(this.chunkQueue.length < MAXCHANKQSIZE && chStart < this.file.size) {
      this.bytesEnqued = chStart + this.options.chunkSize;
      if(this.bytesEnqued > this.file.size) {
        this.bytesEnqued = this.file.size;
      }
      this.chunkQueue.push([chStart, this.bytesEnqued]);
      chStart = this.bytesEnqued;
    }
  };

  BasicClient.prototype._uploadChunk = function(chunkQueue) {
    if(chunkQueue.length === 0) {
      return setTimeout(this._onTimer.bind(this), 10);  // reset stack
    }

    var self = this;
    var ch = chunkQueue.shift();

    var headers = {
      'Offset': ch[0],
      'Content-Type': 'application/offset+octet-stream'
    };

    angular.extend(headers, this.options.headers);

    var blob  = this.slice.call(this.file, ch[0], ch[1], this.file.type);

    // console.log('Chunk ' + ch[0] + '->' + ch[1]);

    function _send(data) {

      var req = {
        method: 'PATCH',
        url: self.fileUrl,
        data: data.target.result,
        transformRequest: [],
        contentType: self.file.type,
        cache: false,
        headers: headers
      };

      $http(req).success(function(data, status, headers, config) {
        self.bytesWritten += config.data.byteLength;
        self._deferred.notify(self.bytesWritten);
        self._uploadChunk(chunkQueue);
      }).error(function(data, status, headers, config) {
        // TODO: retry
        self._emitFail(status);
        return;
      });
    }
    this.reader.onload = _send;
    this.reader.readAsArrayBuffer(blob);
  };

  BasicClient.prototype.stop = function() {
    this._deferred.reject('cacelled');
  };

  BasicClient.prototype._emitDone = function() {
    this._deferred.resolve(this.fileUrl, this.file);
  };

  BasicClient.prototype._emitFail = function(err) {
    this._deferred.reject(err);
  };

  function basicfprint(file) {
    return 'tus-' + file.name + '-' + file.type + '-' + file.size;
  };

  BasicClient.prototype._urlCache = function(url) {
    var fingerPrint = this.options.fingerprint;
    if (fingerPrint === undefined) {
      fingerPrint = basicfprint(this.file);
    }

    if (url === false) {
      console.log('Resetting any known cached url for ' + this.file.name);
      return localStorage.removeItem(fingerPrint);
    }

    if (url) {
      var result = false;
      try {
        result = localStorage.setItem(fingerPrint, url);
      } catch (e) {
        // most likely quota exceeded error
      }

      return result;
    }

    return localStorage.getItem(fingerPrint);
  };

  return {
    Client: BasicClient
  };

});
