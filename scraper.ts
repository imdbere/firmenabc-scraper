import { asyncParallelForEach } from "async-parallel-foreach";
import axios, { AxiosError } from "axios";
import { writeFileSync } from "fs";
import { Node, NodeType, parse as parseHtml } from 'node-html-parser';
import { parse as parseVcard } from "vcard4";
var vCard = require('vcard-parser');

async function getCompanies(search: string, paginationNr: number) {
    var url = `https://www.firmenabc.at/result.aspx?what=${encodeURIComponent(search)}&where=&exact=false&inTitleOnly=false&l=&si=${paginationNr}&iid=&sid=-1&did=&cc=`;

    try {
        var res = await axios.get(url, {maxRedirects: 0});
        var html = parseHtml(res.data);

        const content = html.querySelectorAll('.companies .result .result-content');

        const companies = content.map(c => {
            var link = c.querySelector('a')?.attrs['href']!;
            var title = c.querySelector('h2')?.innerText!;

            return {link, title};
        });

        console.log(`Fetched results for ${search}, pag: ${paginationNr}`);

        return companies;
    }
    catch (ex: any) {
        const status = ex.response.status;
        if (status == 301) return [];

        throw ex;
    }
}

async function getCompaniesPaginated(search: string, maxPag: number) {
    var links: {title: string, link: string}[] = [];
    for(var i = 0; i<maxPag; i+=50) {
        var companies = await getCompanies(search, i);    
        if (companies.length == 0)
            break;

        links.push(...companies);
    }

    return links;
    //console.log(links);
}

interface Person {
    title: string
}

async function getCompanyInfo(link: string) {
    const res = await axios.get(link);
    var html = parseHtml(res.data);

    var vcard = html.querySelector('a[target="vCard"]')?.attrs["href"];
    var vcardRes = await axios.get(vcard!);

    var vcardParsed = vCard.parse(vcardRes.data);
    var email = vcardParsed.email[0].value;
    var tel = vcardParsed.tel[0].value;

    var companyName = html.querySelector("h1")!.innerText;

    var baseDiv = html.querySelector('#crefo')?.childNodes[3];
    if (!baseDiv) return null;

    var peopleInfoTable = baseDiv!.childNodes[7];
    if (!peopleInfoTable!.innerText.includes("Handelnde Personen")) {
        peopleInfoTable = baseDiv!.childNodes[8];
    }

    var currentNode : any = {};
    var peopleList: any = [];

    var perviousIsBr = false;
    for (const node of peopleInfoTable.childNodes!) {
        //console.log((node as any)["rawTagName"]);
        var text = node.innerText.trim();
        if (node.nodeType == NodeType.TEXT_NODE && !text)
            continue;

        if (nodeIs(node, "br")) {
            if (perviousIsBr) {
                perviousIsBr = false;
                if (currentNode.title != "Handelnde Personen:") {
                    peopleList.push(currentNode);
                }
                currentNode = {};
            }
            else {
                perviousIsBr = true;
            }
            continue;
        }

        perviousIsBr = false;

        if (nodeIs(node, "strong")) {
            currentNode.title = node.innerText;
            continue;
        }
        
        if (text) {
            if (text == "Privatperson")
            currentNode.privateIndividual = true;
            else if (text.includes("Anteil")) {
                const shares = +text.split("Anteil: ")[1].replace(',', '.').replace('%', '').trim();
                currentNode.shares = shares;
            }
            else if (!currentNode.name) {
                currentNode.name = text;
            }
        }
    }

    var company = {
        companyName,
        email,
        tel,
        url: link,
        vcard,
        shareholders: peopleList as any[]
    }

    return company;
}

function nodeIs(node: Node, tagName: string) {
    return (node as any)["rawTagName"] == tagName;
}


async function scrapeSearchWord(search: string) {
    console.log('Now scraping word ' + search);

    var companies = await getCompaniesPaginated(search, 10000);
    var filteredCompanies = companies.filter(c => 
        (c.title.includes("GmbH") || c.title.includes("m.b.H.")) && !c.title.includes('KG') && !c.title.includes('OG')
    );

    var details : any = [];
    await asyncParallelForEach(filteredCompanies, 20, async (company: any, i) => {
        console.log('Scraping company ' + company.title);

        var info = await getCompanyInfo(company.link);
        if (!info)
            return;
            
        if (!info.email && !info.tel)
            return;

        if (info.shareholders.some(s => !s.privateIndividual)) 
            return;

        if (!info.shareholders.some(s => s.shares > 75))
            return;

        details.push(info);
    })

    var fileName = search.toLowerCase().replace(' ', '_') + '.json';
    writeFileSync('out/' + fileName, JSON.stringify(details));
}

async function main() {
    await scrapeSearchWord('Vermögensverwaltung');
    await scrapeSearchWord('Ventures');
    await scrapeSearchWord('Capital');
    //getCompanyInfo('https://www.firmenabc.at/kurt-stromberger-handels-u-vermoegensverwaltungs-ges-m-b-h_KNSZ');
    //getCompanyInfo('https://www.firmenabc.at/wien-laurenzerberg-vermoegensverwaltung-gmbh_MjbK');
    
}

main();


