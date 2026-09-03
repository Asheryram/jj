import 'dotenv/config'

const key = process.env.PAYSTACK_SECRET_KEY
const response = await fetch('https://api.paystack.co/settlement?perPage=1', {
  headers: { Authorization: `Bearer ${key}` },
})
console.log(JSON.stringify(await response.json(), null, 2))
