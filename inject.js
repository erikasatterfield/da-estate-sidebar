class InjectScript {
    constructor() {
        console.log("InjectScript loaded");
        this.resultsList = [];
        this.createSidebar();
        this.registerEventHandlers();
        this.waitForResultsListChange();
        this.cache = {};
        this.opened = false;
    }
    registerEventHandlers() {
        $(document).on("click", "#ext-sidebar-show-btn", () => {
            $("#ResultsPaneDiv").hide();
            $("#ext-sidebar").show();
            this.opened = true;
            return false;
        });
        $(document).on("click", "#ext-sidebar-close-btn", () => {
            $("#ResultsPaneDiv").show();
            $("#ext-sidebar").hide();
            this.opened = false;
            return false;
        });
        $(document).on("click", "#save_csv_btn", () => {
            this.saveCSV();
            return false;
        });
    }
    waitForResultsListChange() {
        let panel = $("#ResultsPaneDiv");
        if (panel.length > 0) {
            let resultsList = [];
            panel.find(".resultitem")
                .toArray()
                .forEach((result) => resultsList.push(result.id));
            if (JSON.stringify(resultsList) !== JSON.stringify(this.resultsList)) {
                this.resultsList = resultsList;
                this.updateSidebar();
                if (panel.find("#ext-sidebar-show-btn").length === 0) {
                    panel.find(".results-header").append(detailsButton);
                }
            }
        }
        setTimeout(() => { this.waitForResultsListChange(); }, 100);
        // console.log( 'hey' );
    }
    createSidebar() {
        this.waitFor(".map-wrap")
            .then(() => {
            $(".map-wrap").append(sidebarTemplate);
            $("#ext-sidebar").hide();
        });
    }
    updateSidebar() {
        let panel = $("#ResultsPaneDiv");
        let items = panel.find(".resultitem");
        let sidebarItems = [];
        for (let item of items) {
            let itemId = item.id;
            let tempCache = this.cache;
            //Deleting Garbage
            if (!this.cache[itemId]) {
                this.loadReport(item.id, $(item).find("a:contains(Report)")[0].href);
                let removing = $('<span style="color:red;z-index:99;">[Remove]</span>');
                removing.click(function() {
                    $(item).remove();
                    delete tempCache[itemId];
                    let str = $('script[type="text/javascript"]')[1].text;
                    let map = JSON.parse(str.slice(29,str.length-75));
                    $.ajax({
                        type: 'post',
                        url: 'https://qpublic.schneidercorp.com/api/beaconCore/SetResults?QPS='+map['QPS'],
                        data: JSON.stringify({
                            keys: Object.keys(tempCache).map(function(key, index) {
                                return tempCache[key].parcelId;
                            }),
                            layerId: map['LayerId'],
                            ts: Date.now()
                        }),
                        headers: {
                            'content-type': 'application/json'
                        }
                    });
                });
                $(item).append(removing);
            }
            //Other Display
            // let itemData = {
            //     id: item.id,
            //     photo: this.cache[itemId].photo || chrome.extension.getURL("icons/no_image_placeholder.png"),
            //     propertyAddress: this.cache[itemId].propertyAddress,
            //     parcelId: this.cache[itemId].parcelId,
            //     totalSqFt: this.cache[itemId].totalSqFt && this.cache[itemId].totalSqFt.toString() || "0",
            //     totalAcreage: this.cache[itemId].totalAcreage && this.cache[itemId].totalAcreage.toString() || "0",
            //     mostRecentFairMarkets: this.cache[itemId].mostRecentFairMarkets,
            //     marketPrice: formatMoney(this.cache[itemId].marketPrice),
            //     owner: this.cache[itemId].owner,
            //     detailsUrl: this.cache[itemId].detailsUrl
            // };
            let itemData2 = Object.assign({ id: item.id }, this.cache[itemId]);
            if( ! itemData2.photo ) {
                itemData2.photo = chrome.extension.getURL("icons/no_image_placeholder.png");
            }
            itemData2.marketPrice = formatMoney(itemData2.marketPrice);
            // console.log( this.cache[itemId] );
            sidebarItems.push(sidebarItemTemplate(itemData2));
        }
        $("#ext-sidebar").replaceWith(sidebarTemplate
            .replace("{display}", (this.opened ? "block" : "none"))
            .replace("{children}", sidebarItems.join("\n")));
    }
    loadReport(id, url) {
        this.cache[id] = new Entry();
        this.cache[id].loading = true;
        $.ajax({
            url: url,
            type: "GET",
            success: (response) => {
                response = $(response);
                let entry = new Entry();
                let summarySection = response.find("#ctlBodyPane_ctl00_mSection");
                let commImprSection = response.find("#ctlBodyPane_ctl06_mSection");
                let salesSection = response.find("#ctlBodyPane_ctl11_mSection");
                let valuationSection = response.find("#ctlBodyPane_ctl13_ctl01_grdValuation");
                let photoSection = response.find("#ctlBodyPane_ctl14_mSection");

                function getSection(selector, notSelector) {
                    let unSelect = '';
                    if (notSelector) {
                        unSelect = ':not(:contains(' + notSelector + '))';
                    }
                    return response.find('.title:contains(' + selector + ')' + unSelect).closest('section');
                }

                let dom = {
                    summary: getSection('Summary'),
                    owner: getSection('Owner'),
                    land: getSection('Land'),
                    improvement: getSection('Improvement Information'),
                    sales: getSection('Sales','Area Sales Report'),
                    valuation: getSection('Valuation'),
                    photo: getSection('Photo')
                };

                entry = {
                    // Summary
                    parcelId: dom.summary.find('td:contains(Parcel Number)').next().text().trim(),
                    propertyAddress: dom.summary.find('td:contains(Location Address)').next().text().trim(),
                    zoningClass: dom.summary.find('td:contains(Zoning)').next().text().trim(),
                    totalAcreage: parseFloat(dom.summary.find('td:contains(Acres)').next().text().trim()) || 0,
                    // Owner
                    owner: dom.owner.find("[id*=OwnerName]").text().trim(),
                    ownerAddress: function(){
                        let ownerAddressTextNodes = dom.owner.find('[id*=Address]').contents().filter(function() {
                            return this.nodeType == Node.TEXT_NODE;
                        });
                        let ownerAddressTextArray = ownerAddressTextNodes.toArray().map( node => node.textContent );
                        ownerAddressTextArray.push(dom.owner.find('[id*=City]').text().trim());
                        return ownerAddressTextArray.length ? ownerAddressTextArray.join(', ') : 'Unknown';
                    }(),
                    // Improvement
                    totalSqFt: function(){
                        let totalSqFt = 0;
                        let sqFeetElems = dom.improvement.find("td:contains(Square Feet)").next();
                        sqFeetElems.toArray().forEach((elem) => {
                            totalSqFt += parseInt(elem.innerText);
                        });
                        return totalSqFt;
                    }(),
                    multipleFloors: function(){
                        let floors = dom.improvement.find(".tabular-data-two-column");
                        return floors.length || 1;
                    }(),
                    // Land
                    description: dom.land.find('td:contains(Description)').eq(0).next().text().trim() || 'N/A',
                    salesReason: 'Just Because'



                };

                // Reason
                let lastSaleMoreThan0Dollar = salesSection.find("tbody>tr:first:not(:contains($0))");
                // if (lastSaleMoreThan0Dollar.length > 0) {
                //     entry.salesReason = lastSaleMoreThan0Dollar.find("td").eq(4).text().trim();
                // }
                // Fair Market Sale / Market Price
                let fairMarketsSales = salesSection.find("tbody>tr:contains(Fair Market)");
                let lastFairMarketsSale = null;
                if (fairMarketsSales.length > 0) {
                    lastFairMarketsSale = $(fairMarketsSales[0]);
                }
                if (fairMarketsSales.length > 0) {
                    entry.mostRecentFairMarkets = lastFairMarketsSale.find("td").eq(0).text().trim();
                    entry.marketPrice = lastFairMarketsSale.find("td").eq(3).text().trim();
                // } else {
                //     entry.mostRecentFairMarkets = 'A while ago';
                }
                // Market Price continued
                if (lastSaleMoreThan0Dollar.length > 0) {
                    entry.marketPrice = parseMoney(lastSaleMoreThan0Dollar.find("td").eq(3).text().trim());
                }
                // Cost Per Acre
                entry.costPerAcre = (entry.marketPrice / entry.totalAcreage).toFixed(2);
                // Cost Per Sqft
                entry.costPerSqFt = (entry.marketPrice / entry.totalSqFt).toFixed(2);
                // Most Recent Tax Accessors Total Value
                entry.mostRecentTaxAccessorsValue = valuationSection.find("tr:contains(Current Value)>td.value-column").eq(0).text().trim();
                // Most Recent Tax Accessors Land Value
                entry.pullOutLand = valuationSection.find("tr:contains(Land Value)>td.value-column").eq(0).text().trim();
                // Value of Improments Based on Last Sale
                entry.improvement = valuationSection.find("tr:contains(Improvement Value)>td.value-column").eq(0).text().trim();
                // Accessory Value
                entry.accessory = valuationSection.find("tr:contains(Accessory Value)>td.value-column").eq(0).text().trim();
                // Other
                let photos = photoSection.find("img");
                if (photos.length > 0) {
                    entry.photo = photos[0].src;
                }
                entry.detailsUrl = url;
                this.cache[id] = entry;
                console.log( entry );
                this.updateSidebar();
            },
            error: (err) => {
                delete this.cache[id];
            }
        });
    }
    saveCSV() {
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
        csvContent += labels.join(",") + "\n";
        for (let key in this.cache) {
            csvContent += this.cache[key].toCSVRow();
        }
        csvContent = csvContent.replace(/undefined/g, "");
        let link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("disabled", "true");
        link.setAttribute("download", `Estate Report.csv`);
        document.body.appendChild(link); // Required for FF
        link.click();
    }
    waitFor(selector) {
        return new Promise((resolve) => {
            let resolved = false;
            let element = $(selector, document).get(0);
            if (element) {
                resolve(element);
            }
            else {
                let observer = new MutationObserver(function () {
                    if (resolved === false) {
                        element = $(selector, document).get(0);
                        if (element) {
                            resolve(element);
                            observer.disconnect();
                            resolved = true;
                        }
                    }
                });
                observer.observe(document, {
                    childList: true,
                    subtree: true,
                });
            }
        });
    }
    wait(time) {
        return new Promise((resolve) => {
            setTimeout(resolve, time);
        });
    }
}
class Entry {
    toCSVRow() {
        return "" +
            `\"${this.parcelId}\",` +
            `\"${this.propertyAddress}\",` +
            `\"${this.owner}\",` +
            `\"${this.ownerAddress}\",` +
            `\"${this.multipleFloors}\",` +
            `\"${this.totalAcreage}\",` +
            `\"${this.totalSqFt}\",` +
            `\"${this.zoningClass}\",` +
            `\"${this.description}\",` +
            `\"${this.salesReason}\",` +
            `\"${this.mostRecentFairMarkets}\",` +
            `\"${this.marketPrice}\",` +
            `\"${this.costPerAcre}\",` +
            `\"${this.costPerSqFt}\",` +
            `\"${this.mostRecentTaxAccessorsValue}\",` +
            `\"${this.pullOutLand}\",` +
            `\"${this.improvement}\",` +
            `\"${this.accessory}\",` +
            `\"${this.photo}\"\n`;
    }
}
function formatMoney(val) {
    return `${commafy(val)}`;
}
function parseMoney(val) {
    return parseInt(val
        .replace("$", "")
        .replace(/,/g, ""));
}
function commafy(num) {
    if (!num) {
        return "0";
    }
    let str = num.toString().split('.');
    if (str[0].length >= 5) {
        str[0] = str[0].replace(/(\d)(?=(\d{3})+$)/g, '$1,');
    }
    if (str[1] && str[1].length >= 5) {
        str[1] = str[1].replace(/(\d{3})/g, '$1 ');
    }
    return str.join('.');
}
const labels = [
    "PARCEL ID",
    "PROPERTY ADDRESS",
    "OWNER",
    "OWNER ADDRESS",
    "Multiple floors",
    "TOTAL ACREAGE",
    "Total sq ft",
    "Zoning Class",
    "DESCRIPTION",
    "Sales/Reason",
    "Most recent: Fair Markets",
    "Market price",
    "Cost per acre",
    "Cost per square foot",
    "MOST RECENT TAX ASSESSORS VALUE",
    "LAND ASSESSMENT VALUE",
    "VALUE OF IMPROVEMENTS BASED ON MOST RECENT SALE",
    "Accessory",
    "PHOTO"
];
const detailsButton = `
    <button id="ext-sidebar-show-btn">Details</button>
`;
const sidebarTemplate = `
    <div id="ext-sidebar" class="slim-scrollbar" style="
        position: absolute;
        right: 0;
        width: 350px;
        background-color: rgba(255,255,255,.9);
        overflow-x: auto;
        border-left: 1px solid #aaa;
        padding: 4px;
        top: 108px;
        bottom: 0;
        display: {display}
    ">
        <section class="ext-header">
            <h2 style="display: inline-block;">Real Estate Comparer</h2>
            <span
                id="ext-sidebar-close-btn"
                class="glyphicon glyphicon-remove-circle pull-right"
                title="Close"
                style="
                    color: #aaa;
                    cursor: pointer;
            "></span>
            <button id="save_csv_btn">Save CSV</button>
            <hr/>
        </section>
        {children}
    </div>
`;
function sidebarItemTemplate( data ) {
    return `
        <div id="${data.id}" class="ext-result" style="clear: both; padding-bottom: 10px; overflow: hidden;">
            <div style="width: 50%; float: left; padding-right: 10px;">
                <img src="${data.photo}"
                     style="max-width: 100%;" />
            </div>
            <div style="width: 50%; float: left;">
                <b>${data.propertyAddress}</b><br/>
                <b>${data.parcelId}</b><br/>
                <b>${data.totalSqFt}</b>&nbsp;sq&nbsp;ft<br/>
                <b>${data.totalAcreage} acres</b>&nbsp;lot<br/>
                <b>${data.mostRecentFairMarkets}</b>&nbsp;Last&nbsp;Sale&nbsp;Date<br/>
                <b>${data.marketPrice}</b>&nbsp;Last&nbsp;Sale&nbsp;Price<br />
                <b>${data.owner}</b>
                <a href="${data.detailsUrl}" target="_blank">Details</a><br />
                <br /><br /><br />
<strong>Cost Per Acre: </strong>${data.costPerAcre}<br />

<strong>Cost Per sqft: </strong>${data.costPerSqFt}<br />

<strong>Details link: </strong>${data.detailsUrl}<br />

<strong>Improvement Value: </strong>${data.improvement}<br />

<strong>Market Price: </strong>${data.marketPrice}<br />

<strong>Most Recent Fair Market: </strong>${data.mostRecentFairMarkets}<br/>

<strong>Tax Accessors Value: </strong>${data.mostRecentTaxAccessorsValue}<br />

<strong>Floors?: </strong>${data.multipleFloors}<br />

<strong>Owner: </strong>${data.owner}<br />

<strong>Owner Address: </strong>${data.ownerAddress}<br />

<strong>Parcel ID: </strong>${data.parcelId}<br />

<strong>Photo link: </strong>${data.photo}<br />

<strong>Address: </strong>${data.propertyAddress}<br />

<strong>Land Value: </strong>${data.pullOutLand}<br />

<strong>Acreage: </strong>${data.totalAcreage}<br />

<strong>Total Sqft: </strong>${data.totalSqFt}<br />

<strong>Zoning Class: </strong>${data.zoningClass}<br />
<strong>Sales Reason: </strong>${data.salesReason}<br />
<hr />







            </div>
        </div>
    `;
}
let injectScript = new InjectScript();
//# sourceMappingURL=inject.js.map
