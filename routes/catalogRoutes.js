import { Router } from "#constants";
import { catalogController } from "#controllers";

const CatalogRouter = Router();

// Public: admin-managed lists + app config for the clients.
CatalogRouter.get("/", catalogController.getCatalog);

export { CatalogRouter };
