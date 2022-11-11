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
                console.log(JSON.stringify(response))
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
    var ppm = (dataObj.procs / msToMinutes(dataObj.duration)).toFixed(1);
    var resourcesString = getResourcesString(dataObj.resources);
    var timedResources = getTimedResources(dataObj.resources, dataObj.duration);
    var timedResourcesString = getTimedResourcesString(timedResources);
    var header = $(`<h3 class="section-header">
                        <div class="header-content">
                            <div>${capitalize(metric)}: ${formatTime(dataObj.duration)} fight time</div>
                            <div>${dataObj.procs.toLocaleString()} total procs. ${ppm} ppm.</div>
                            <div>${resourcesString}</div>
                            <div>${timedResourcesString}</div>
                        </div>
                    </h3>`)
    resultSectionContainer.append(header);
    var characterSection = generateCharacterSection(dataObj.characters, dataObj.duration);
    resultSectionContainer.append(characterSection);
    return resultSectionContainer;
}
/*
function generateCharacterSection(characterList){
    var characterSection = $(`<div class="character-section"></div>`)
    var list = $(`<ul></ul>`);
    for(var character of characterList){
        //TODO: Fix here for character break down
        var listItem = $(`<li>${character.name}: ${character.ppm.toFixed(1)} ppm. ${character.procs} total procs. ${character.resources}</li>`)
        list.append(listItem);
    }
    characterSection.append(list);
    return characterSection;
}
*/
function generateCharacterSection(characterList, duration){
    var characterSection = $(`<div class="character-section"></div>`)
    var table = $(`<table class="character-table"/>`);
    for(var character of characterList){
        var ppm = formatDecimal(character.procs / msToMinutes(duration));
        var resourcesArray = getResourcesArray(character.resources);
        var timedResourcesArray = getTimedResourcesArray(getTimedResources(character.resources, duration));
        var row = $(`<tr class="character-row"/>`);
        row.append(`<td class="character-cell character-name">${character.name}</td>`);
        row.append(`<td class="character-cell character-procs">${character.procs} proc${character.procs === 1 ? "" : "s"}</td>`);
        row.append(`<td class="character-cell character-ppm">${ppm} ppm</td>`);
        var resourcesElem = $(`<td class="character-cell character-resources"/>`);
        for(var resource of resourcesArray){
            resourcesElem.append(`<div class="resource-div">${resource}</div>`)
        }
        row.append(resourcesElem);
        var timedResourcesElem = $(`<td class="character-cell character-timed-resources"/>`);
        for(var resource of timedResourcesArray){
            timedResourcesElem.append(`<div class="timed-resource-div">${resource}</div>`)
        }
        row.append(timedResourcesElem);
        table.append(row);
    }
    characterSection.append(table);
    return characterSection;
}

function capitalize(string){
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function getResourcesString(resources){
    return getResourcesArray(resources).join(", ");
}

function getResourcesArray(resources){
    var result = [];
    var resourceTypes = Object.keys(resources);
    resourceTypes.sort(resourceSort);
    for(var resource of resourceTypes){
        result.push(`${resources[resource].toLocaleString()} ${resource}`);
    }
    return result;
}

function resourceSort(a, b){
    return resourceTypeOrder(a) - resourceTypeOrder(b);
}

function getTimedResources(resources, duration){
    var timedResources = {}
    for(var resource in resources){
        var resourceName = ""
        var timeScale = 1;
        switch(resource){
            case "energy":
                resourceName = "eps";
                timeScale = msToSeconds(duration);
                break;
            case "rage":
                resourceName = "rps";
                timeScale = msToSeconds(duration);
                break;
            case "runic power":
                resourceName = "rpps";
                timeScale = msToSeconds(duration);
                break;
            case "mana":
                resourceName = "mp5";
                timeScale = msToSeconds(duration) / 5;
                break;
        }
        timedResources[resourceName] = formatDecimal(resources[resource] / timeScale);
    }
    return timedResources;
}

function formatDecimal(number){
    if(number < 1){
        return number.toPrecision(2);
    }
    else{
        return Math.round(number*100)/100;
    }
}

function formatTime(ms){
    var result = [];
    var time = ms;
    var hours = msToHours(time);
    if(hours >= 1){
        var truncHours = Math.trunc(hours)
        result.push(`${truncHours} hour${truncHours > 1 ? "s":""}`)
        time -= truncHours * 60 * 60 * 1000;
    }
    var minutes = msToMinutes(time);
    if(minutes >= 1){
        var truncMinutes = Math.trunc(minutes)
        result.push(`${truncMinutes} minute${truncMinutes > 1 ? "s":""}`)
        time -= truncMinutes * 60 * 1000;
    }
    var seconds = msToSeconds(time);
    if(seconds >= 1){
        var truncSeconds = Math.trunc(seconds);
        result.push(`${truncSeconds} second${truncSeconds > 1 ? "s":""}`);
    }
    return result.join(" ");
}

function getTimedResourcesString(timedResources){
    return getTimedResourcesArray(timedResources).join(", ");
}

function getTimedResourcesArray(timedResources){
    var result = [];
    var resourceTypes = Object.keys(timedResources);
    resourceTypes.sort(timedResourceSort);
    for(var resource of resourceTypes){
        result.push(`${timedResources[resource].toLocaleString()} ${resource}`);
    }
    return result;
}

function timedResourceSort(a, b){
    return timedResourceTypeOrder(a) - timedResourceTypeOrder(b);
}

function resourceTypeOrder(resourceType){
    switch(resourceType){
        case "energy":
            return 0;
        case "rage":
            return 1;
        case "runic power":
            return 2;
        case "mana":
            return 3;
    }
}

function timedResourceTypeOrder(timedResourceType){
    switch(timedResourceType){
        case "eps":
            return 0;
        case "rps":
            return 1;
        case "rpps":
            return 2;
        case "mp5":
            return 3;
    }
}

function msToHours(ms){
    return msToMinutes(ms) / 60;
}

function msToMinutes(ms){
    return msToSeconds(ms) / 60;
}

function msToSeconds(ms){
    return ms / 1000;
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