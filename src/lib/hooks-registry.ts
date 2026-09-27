// Alle Module, die nach einem Import etwas tun oder eigene Importformate anbieten,
// tragen sich hier ein.
import { onAfterImport } from "./hooks";
import { syncClaims } from "./claims/service";

onAfterImport("ansprueche", async (tenantId) => {
  await syncClaims(tenantId);
});

import { refreshStockWarnings } from "./stock/warnings";
onAfterImport("bestandswarnungen", refreshStockWarnings);

import "./orders/csv";

import { refreshServiceTasks } from "./service/tasks";
onAfterImport("service", refreshServiceTasks);
