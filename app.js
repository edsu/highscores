var http = require('http'),
    async = require('async'),
    moment = require('moment'),
    xml2js = require('xml2js'),
    express = require('express'),
    request = require('request'),
    socketio = require('socket.io'),
    redis = require('redis').createClient();

/**
 * Set up the webserver.
 */

function main() {
  var app = express();
  var server = http.createServer(app);
  var io = socketio.listen(server);
  var recent = []

  app.configure(function() {
    app.use(express.static(__dirname + '/public'));
  });

  io.sockets.on('connection', function(socket) {
    recent.map(function (item) {
      socket.emit('item', item);
      getHighscores(function(scores) {
        socket.emit('highscores', scores);
      });
    });
  });

  worldcat(function(item) {
    io.sockets.emit('item', item);
    getHighscores(function(scores) {
      io.sockets.emit('highscores', scores);
    });
    recent.push(item);
    recent = recent.slice(0, 40);
  });

  server.listen(process.env.PORT || 3000);
}

/**
 * worldcat will pass newly cataloged items in Worldcat 
 * to the callback you supply. maxseq is optional, and really
 * only used when worldcat is called recursively.
 */

function worldcat(callback, maxseq) {
  url = 'http://experimental.worldcat.org/xwwg/rest/feed?format=json';
  if (maxseq) url += "&start=seq-" + maxseq;

  console.log(url);
  request.get({url: url, json: true}, function (e, r, results) {
    results.newrec.map(function (item) {
      annotate(item, callback);
    });
    setTimeout(function() {
      worldcat(callback, results.maxseq);
    }, 10000);
  });

}

/**
 * annotates items with additional information from the OCLC Registry API
 */

function annotate(item, callback) {
  // add a URL for the item in Worldcat
  item.url = 'http://worldcat.org/oclc/' + item.oclcno;

  // convert epoch time to a Date object
  item.created = new Date(item.created * 1000); 

  // get some information about the organization
  url = 'http://www.worldcat.org/webservices/registry/lookup/Institutions/oclcSymbol/' + item.instsym + '?serviceLabel=content';
  request.get({url: url}, function (e, r, xml) {
    xml2js.parseString(xml, function (e, r) {
      try {
        item.instname = r.institution.nameLocation[0].institutionName[0];
        item.insturl = r.institution.nameLocation[0].otherNameAddress[0].infoSiteUrl[0];
      } catch(err) {
        console.log("no org record for " + item.instsym);
      }
      tally(item);
      callback(item);
    });
  });
}

/**
 * Keep track of some stats using Redis
 */

function tally(item) {
  var m = moment(item.created);
  var day = m.format('YYYYMMDD');

  // keep track of the organization
  var org_id = "org:" + item.instsym;
  redis.zincrby("items:daily:" + day, 1, org_id, function() {});
  redis.hset(org_id, "name", item.instname, function() {});
  redis.hset(org_id, "url", item.url, function() {});
  redis.hset(org_id, "lat", item.instlat, function() {});
  redis.hset(org_id, "lon", item.instlong, function() {});
  redis.zadd(org_id + ":items:" + day, m.unix(), item_id, function() {});

  // keep track of the item
  var item_id = "item:" + item.oclcno;
  redis.hset(item_id, "title", item.title, function() {});
  redis.hset(item_id, "author", item.author, function() {});
  redis.hset(item_id, "publisher", item.publisher, function() {});
  redis.hset(item_id, "year", item.year, function() {});
  redis.hset(item_id, "created", item.created, function() {});

  // keep track of subjects
  if (item.subject) {
    redis.sadd(item_id + ":subjects", item.subject.split("|"), function() {});
    item.subject.split("|").map(function (subject) {
      redis.zincrby("subjects:daily:" + day, 1, subject, function() {});
      redis.sadd("subjects:daily:" + subject, item_id, function() {}); 
    });
  }

}

function getHighscores(callback) {
  redis.zrevrangebyscore(["items:daily:20130208", "+inf", 1, "withscores", "limit", 0, 30], function (err, response) {
    callback(response);
  });
}

if (! module.parent) {
  main();
}


