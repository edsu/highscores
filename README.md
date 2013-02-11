highscores
==========

highscores is a NodeJS application that listens to the 
[Worldcat Live API](http://experimental.worldcat.org/xwwg/) 
to display original [cataloging](http://en.wikipedia.org/wiki/Cataloging) 
"highscores" for the day in realtime on the Web. 

Install
-------

To get it running you will need to:

* install NodeJS, Git and Redis
* git checkout https://github.com/edsu/highscores.git
* cd highscores
* npm install
* node app.js
* open http://localhost:3000/ in your browser

The included Procfile should allow you to easily deploy to Heroku if you want.
You will just need to enable the free Redis database, which should be big enough
for keeping track of daily counts.

    heroku addons:add redistogo

Authors
-------

* Sean Hannan (@MrDys)
* Ed Summers (@edsu)

License
-------

* CC0
