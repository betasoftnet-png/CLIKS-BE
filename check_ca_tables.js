const db = require('./db/connection');
// Require caController to trigger table initialization on development database
const caController = require('./controllers/caController');

async function check() {
  try {
    // Wait for the asynchronous table initialization inside caController to finish
    await new Promise(resolve => setTimeout(resolve, 500));

    const users = await db.prepare("SELECT id, username, email FROM users").all();
    console.log("=== USERS ===");
    console.log(users);

    // Seed Hari (user ID 5)
    console.log("\n=== SEEDING HARI (ID 5) ===");
    const clientCount = await db.prepare("SELECT COUNT(*) as count FROM ca_clients WHERE ca_user_id = ?").get(5);
    console.log("Clients count before seeding:", clientCount.count);
    
    // Trigger getClients to run the full lazy seeding for Hari (user ID 5)
    const reqMock = { user: { id: 5 } };
    const resMock = {
      status: () => resMock,
      json: (data) => {
        console.log("getClients finished with: success =", data.success);
      }
    };
    await caController.getClients(reqMock, resMock);
    await caController.getRequests(reqMock, resMock);
    await caController.getTasks(reqMock, resMock);
    await caController.getTimesheets(reqMock, resMock);
    await caController.getFolders(reqMock, resMock);
    await caController.getFiles(reqMock, resMock);

    const clientsCount = await db.prepare("SELECT ca_user_id, COUNT(*) as count FROM ca_clients GROUP BY ca_user_id").all();
    console.log("\n=== CA CLIENTS COUNT ===");
    console.log(clientsCount);

    const allClients = await db.prepare("SELECT * FROM ca_clients").all();
    console.log("\n=== ALL CA CLIENTS IN DB ===");
    console.log(allClients);

    const invitations = await db.prepare("SELECT * FROM ca_invitations").all();
    console.log("\n=== CA INVITATIONS ===");
    console.log(invitations);
  } catch (err) {
    console.error("DB Check Error:", err.message);
  }
}

check();

