var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm').subClass({ imageMagick: true });
var util = require('util');

var MAX_WIDTH  = 200;
var MAX_HEIGHT = 200;

var s3 = new AWS.S3();

exports.handler = function(event, context) {

  var srcBucket = event.Records[0].s3.bucket.name;

  // Remove spaces or non ASCII characers
  var srcKey = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));

  // NOTE - We're currently putting it right in the original bucket
  var dstBucket = srcBucket;
  var dstKey = srcKey.replace('_full', '');

  var typeMatch = srcKey.match(/\.([^.]*)$/);
  if (!typeMatch) {
    console.error('unable to infer image type for key ' + srcKey);
    return;
  }
  var imageType = typeMatch[1];
  if (imageType !== 'jpg' &&
      imageType !== 'jpeg' &&
      imageType !== 'png') {
    console.log('skipping non-image ' + srcKey);
    return;
  }

  async.waterfall([
    function download(next) {
      // Download the image from S3 into a buffer.
      s3.getObject({
        Bucket: srcBucket,
        Key: srcKey
      }, next);
    },
    function transform(response, next) {
      gm(response.Body).size(function(err, size) {
        // Infer the scaling factor to avoid stretching the image unnaturally.
        var scalingFactor = Math.min(
          MAX_WIDTH / size.width,
          MAX_HEIGHT / size.height
        );
        var width  = scalingFactor * size.width;
        var height = scalingFactor * size.height;

        // Transform the image buffer in memory.
        this.resize(width, height)
          .toBuffer(imageType, function(err, buffer) {
            if (err) return next(err);
            next(null, response.ContentType, buffer);
          });
      });
    },
    function upload(contentType, data, next) {
      // Stream the transformed image to a different S3 bucket.
      s3.putObject({
        Bucket: dstBucket,
        Key: dstKey,
        Body: data,
        ContentType: contentType,
        ACL: 'public-read'
      }, next);
    }
    // TODO - Delete original image
  ], function (err) {
    if (err) {
      console.error(
        'Unable to resize ' + srcBucket + '/' + srcKey +
        ' and upload to ' + dstBucket + '/' + dstKey +
        ' due to an error: ' + err
      );
    } else {
      console.log(
        'Successfully resized ' + srcBucket + '/' + srcKey +
        ' and uploaded to ' + dstBucket + '/' + dstKey
      );
    }

    context.done();
  });
};
