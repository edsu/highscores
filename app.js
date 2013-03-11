var http = require('http'),
    async = require('async'),
    moment = require('moment'),
    xml2js = require('xml2js'),
    express = require('express'),
    request = require('request'),
    socketio = require('socket.io');

if (process.env.REDISTOGO_URL) {
  var rtg   = require("url").parse(process.env.REDISTOGO_URL);
  var redis = require("redis").createClient(rtg.port, rtg.hostname);
  redis.auth(rtg.auth.split(":")[1]); 
} else {
  var redis = require('redis').createClient();
}

/**
 * Set up the webserver.
 */

function main() {
  var app = express();
  var server = http.createServer(app);
  var io = socketio.listen(server);
  var recent = []

  // heroku doesn't do websockets yet
  io.configure(function () {
    io.set("transports", ["xhr-polling"]); 
    io.set("polling duration", 10); 
  });

  app.configure(function() {
    app.use(express.static(__dirname + '/public'));
  });

  io.sockets.on('connection', function(socket) {
    recent.map(function (update) {
      socket.emit('update', update);
    });
  });

  worldcat(function(item) {
    io.sockets.emit('item', item);
    getHighscores(function(scores) {
      var update = {item: item, scores: scores};
      io.sockets.emit('update', update);
      recent.push(update);
      recent = recent.slice(0, 40);
    });
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
    if (e) {
      console.log("unable to fetch " + url + ": " + e);
    }
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
}

/**
 * Will get the top 30 catalogers for the day, and return them as a list
 * of objects, each with a name and score.
 */

function getHighscores(callback) {
  var m = moment(new Date());
  var day = m.format('YYYYMMDD');
  redis.zrevrangebyscore(["items:daily:" + day, "+inf", 2, "withscores", "limit", 0, 30], function (err, response) {
    var highscores = [];
    for (var i=0; i < response.length; i += 2) {
      var symbol = response[i].replace('org:', '')
      var score = {id: response[i], score: response[i+1], symbol: symbol}
      highscores.push(score);
    }
    addOrgNamesToScores(highscores, callback);
  });
}

/**
 * Annotates highscores with the organization names, using the org id.
 * The lookups happen in parallel.
 */

function addOrgNamesToScores(highscores, callback) {
  async.map(highscores, addOrgNameToScore, function(err, results) {
    callback(results);
  });
}

/**
 * Looks up an individual orgnization name using the organization id.
 */

function addOrgNameToScore(score, callback) {
  redis.hget(score.id, "name", function(e, r) {
    score.name = r
    callback(null, score);
  });
}

if (! module.parent) {
  main();
}
