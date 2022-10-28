const express = require('express')
const path = require('path')
const PORT = process.env.PORT || 5000
const { calculate } = require('./calculator');

const LOG_REGEX = /.*warcraftlogs\.com\/reports\/([a-zA-Z0-9\:]+).*|(^[a-zA-Z0-9\:]+$)/;

express()
  .use(express.static(path.join(__dirname, 'public')))
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'ejs')
  .get('/', (req, res) => res.render('pages/index'))
  .get('/calculate', (req, res) => {
    var logMatch = req.query.log.match(LOG_REGEX);
    var logId = logMatch ? logMatch[1] || logMatch[2] : undefined;
    var apiKey = req.query.key
    var error = validate(logId, apiKey);
    if(error){
      res.send({error});
      return;
    }
    calculate(apiKey, logId).catch(error => {
      console.log(error);
      res.send({error: "An unexpected error has occurred. Please check your inputs or try again later."});
    }).then(lbThreeObj => {
      res.send(lbThreeObj);
    });
  })
  .listen(PORT, () => console.log(`Listening on ${ PORT }`))

function validate(logId, apiKey){
  if(logId.length === 0 && apiKey.length === 0){
    return "Please enter a log ID and API key";
  }

  if(logId.length === 0){
    return "Please enter a log ID.";
  }

  if(apiKey.length === 0){
    return "Please enter an API key.";
  }

  if(!logId.match(/^[0-9a-zA-Z:]+$/)){
    return "Invalid log ID. Please check your log URL input";
  }

  if(!apiKey.match(/^[0-9a-zA-Z]+$/)){
    return "Invalid API key, please go to the bottom of https://classic.warcraftlogs.com/profile for instructions on getting an API key."
  }

  return undefined;
}