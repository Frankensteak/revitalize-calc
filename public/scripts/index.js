const loader = $(`<div id="loader-container"><div class="loader"></div><div id="loader-text"></div>`)

$(window).load(function () {
    $("#api-key-more-info").click(function(){
       $('.hover_bkgr_fricc').show();
    });
    $('.hover_bkgr_fricc').click(function(){
        $('.hover_bkgr_fricc').hide();
    });
    $('.popupCloseButton').click(function(){
        $('.hover_bkgr_fricc').hide();
    });
});

function calculate(){
    $("#calculate").prop('disabled', true);
    $("#fetch-error").remove();
    var results = $("#results");
    results.empty();
    results.append(loader);
    startLoaderTimers();
    var logId = $("#log-input").val();
    var apiKey = $("#api-key-input").val();
    var query = `?key=${apiKey}&log=${logId}`;
    fetch(`/calculate${query}`)
        .then(res => {
            clearLoaderTimers();
            loader.remove();
            $("#calculate").prop('disabled', false);
            return res.json();
        })
        .then(response => {
            if(response.error){
                failedFetch(response.error);
            }
            else{
                loader.remove();
                successfulFetch(response);
            }
        })
}

function successfulFetch(resultObj){
    var elem = $("#results");
    elem.empty();
    console.log(resultObj);
    var result = generateResults(resultObj);
    elem.append(result);
    $(".accordion").accordion({
        collapsible: true,
        heightStyle: "content"
    });
    $(".child-accordion").accordion("option", "active", false);
}

function failedFetch(error){
    $(`.box`).append(`<div class="error" id="fetch-error">${error}</div>`)
}

function generateResults(resultObj){
    var name = resultObj.name;
    var resultContainer = $(`<div id="${name}-accordion" class="accordion result-container"></div>`)

    var nameHeader = $(`<h3 class="result-name">${name}</h3>`);
    resultContainer.append(nameHeader);

    var nameContainer = $(`<div class="result-content"></div>`);
    resultContainer.append(nameContainer);

    var overallSection = generateResultSection("overall", resultObj.overall);
    nameContainer.append(overallSection);

    var bossSection = generateResultSection("boss", resultObj.boss);
    nameContainer.append(bossSection);

    var trashSection = generateResultSection("trash", resultObj.trash);
    nameContainer.append(trashSection);

    var bossesContainer = $(`<div class="accordion child-accordion result-bosses-container"></div>`);
    nameContainer.append(bossesContainer);

    var bossesHeader = $(`<h3>Bosses</h3>`)
    bossesContainer.append(bossesHeader);

    var bossesSectionContainer = $(`<div class="result-bosses-content"></div>`)
    bossesContainer.append(bossesSectionContainer);

    for(var boss of resultObj.bosses){
        var bossesSection = generateResultSection(boss.name, boss);
        bossesSectionContainer.append(bossesSection);
    }

    return resultContainer;
}

function generateResultSection(metric, dataObj){
    var resultSectionContainer = $(`<div class="accordion child-accordion result-section-container"></div>`)
    var header = $(`<h3>${capitalize(metric)}: ${dataObj.ppm} procs per minute</h3>`)
    resultSectionContainer.append(header);
    var characterSection = generateCharacterSection(dataObj.characters);
    resultSectionContainer.append(characterSection);
    return resultSectionContainer;
}

function generateCharacterSection(characterList){
    var characterSection = $(`<div class="character-section"></div>`)
    var list = $(`<ul></ul>`);
    for(var character of characterList){
        //TODO: Fix here for character break down
        var listItem = $(`<li>${character.name}: ${character.ppm.toFixed(1)} ppm (${character.resources})</li>`)
        list.append(listItem);
    }
    characterSection.append(list);
    return characterSection;
}

function capitalize(string){
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const TIMEOUTS = [];
function startLoaderTimers(){
    clearLoaderTimers();
    var loaderText = $("#loader-text");
    var twoSec = setTimeout(() => {loaderText.text("Still loading...")}, 5000);
    TIMEOUTS.push(twoSec);
    var fiveSec = setTimeout(() => {loaderText.text("Any minute now...")}, 10000);
    TIMEOUTS.push(fiveSec);
    var tenSec = setTimeout(() => {loaderText.text("It could be broken...")}, 15000);
    TIMEOUTS.push(tenSec);
}

function clearLoaderTimers(){
    $("#loader-text").text("");
    while(TIMEOUTS.length > 0){
        var timerID = TIMEOUTS.pop();
        clearTimeout(timerID);
    }
}