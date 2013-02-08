var http = require('http'),
    xml2js = require('xml2js'),
    express = require('express'),
    request = require('request'),
    socketio = require('socket.io');

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
    });
  });

  worldcat(function(item) {
    io.sockets.emit('item', item);
    recent.push(item);
  });

  server.listen(process.env.PORT || 3000);
}

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
  item.url = 'http://worldcat.org/oclc/' + item.oclcno;
  url = 'http://www.worldcat.org/webservices/registry/lookup/Institutions/oclcSymbol/' + item.instsym + '?serviceLabel=content';
  request.get({url: url}, function (e, r, xml) {
    xml2js.parseString(xml, function (e, r) {
      try {
        item.instname = r.institution.nameLocation[0].institutionName[0];
        item.insturl = r.institution.nameLocation[0].otherNameAddress[0].infoSiteUrl[0];
      } catch(err) {
        console.log("no org record for " + item.instsym);
      }
      callback(item);
    });
  });
}

if (! module.parent) {
  main();
}


