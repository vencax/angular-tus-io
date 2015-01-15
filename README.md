# angular-tus-io

[TUS.io](http://www.tus.io/) client with angular as the only dependency.

## features

- HTML5 FileAPI used
- per chunk uploads
- chunk retry mechanism

### planned

- CRC of chunks
- variable chunk size

## example of usage

```javascript
var _onProgress = function(bytesUploaded) {
  percentage = (bytesUploaded / $scope.file.size * 100).toFixed(2);
  $scope.file.progress = percentage
};

var _onError = function(error) {
  $scope.file.status = 'failed: ' + error;
};

var _onDone = function() {
  $scope.file.status = 'uploaded';
};

var uploader = new BasicTUS.Client($scope.file, options);
uploader.then(_onDone, _onError, _onProgress);
```
