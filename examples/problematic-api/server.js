import fs from "node:fs";

export async function loadCustomers(customerIds) {
  const configuration = fs.readFileSync("config.json", "utf8");
  const customers = [];

  for (const customerId of customerIds) {
    customers.push(await fetch(`/customers/${customerId}`));
  }

  setInterval(() => console.log("heartbeat", configuration), 1_000);
  return customers;
}
