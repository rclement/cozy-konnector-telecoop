const { BaseKonnector, requestFactory, log } = require('cozy-konnector-libs')

const moment = require('moment')

const request = requestFactory({
  debug: false,
  cheerio: false,
  json: true,
  jar: true
})

const vendor = 'telecoop'
const baseUrl = 'https://espace-personnel-api.telecoop.fr'
const loginUrl = `${baseUrl}/api/customer/login`
const invoicesUrl = `${baseUrl}/api/customer/invoices`

module.exports = new BaseKonnector(start)

async function start(fields, cozyParameters) {
  log('info', 'Authenticating ...')
  if (cozyParameters) log('debug', 'Found COZY_PARAMETERS')
  const auth = await authenticate.bind(this)(fields.email, fields.password)
  const headers = { Authorization: `${auth.token_type} ${auth.token}` }
  log('info', 'Successfully logged in')

  let documents = []

  log('info', 'Fetching the list of documents')
  let invoices = await request(invoicesUrl, { headers })

  while (invoices.meta.pagenum <= invoices.meta.nbpages) {
    log('info', 'Parsing list of documents')
    const pageDocuments = await parseDocuments(headers, invoices.data)
    documents.push(...pageDocuments)

    log('info', 'Finding next page')
    const nextpage = invoices.meta.pagenum + 1
    invoices = await request(`${invoicesUrl}?pagenum=${nextpage}`, { headers })
  }

  log('info', 'Saving data to Cozy')
  await this.saveBills(documents, fields, {
    sourceAccount: this.accountId,
    sourceAccountIdentifier: fields.email,
    identifiers: [vendor],
    contentType: 'application/pdf',
    processPdf: parsePdfAmountCurrency
  })
}

async function authenticate(email, password) {
  const res = await request({
    method: 'POST',
    url: loginUrl,
    body: { email, password },
    resolveWithFullResponse: true
  })

  if (res.statusCode !== 200) {
    throw new Error('LOGIN_FAILED')
  }

  return res.body
}

function parseDocuments(headers, documents) {
  return documents.map(async doc => {
    const docData = await request(`${invoicesUrl}/${doc.id}`, { headers })

    const fileurl = docData.link
    const date = moment.utc(doc.formatted_created, 'DD/MM/YYYY')
    const amount = 0.0 // default empty amount to be retrieved with `processPdf`
    const currency = '€' // default currency to be retrieved with `processPdf`
    const filename = `${date.format('YYYY-MM-DD')}_${vendor}_${doc.ident}.pdf`

    return {
      vendor: vendor,
      date: date.toDate(),
      amount: amount,
      currency: currency,
      fileurl: fileurl,
      filename: filename,
      metadata: {
        importDate: new Date(),
        version: 1
      }
    }
  })
}

function parsePdfAmountCurrency(entry, text) {
  // find the net total amount line index
  const lines = text.split('\n')
  const ttcLineIdx = lines.findIndex(e => e === 'Total net TTC')
  if (ttcLineIdx > -1) {
    // the net total amount data is the next line
    const rawAmount = lines[ttcLineIdx + 1].split(' ')
    // format: from 'dd,dd €' to ['dd.dd', '€']
    const amount = parseFloat(rawAmount[0].replace(',', '.'))
    const currency = rawAmount[1]
    Object.assign(entry, {
      amount,
      currency
    })
  }
}
