import { Router } from "#constants";
import { placesController } from "#controllers";

const PlacesRouter = Router();

// Public: place search (admin cities + OpenStreetMap, Azerbaijan only).
PlacesRouter.get("/suggest", placesController.suggestPlaces);
PlacesRouter.get("/reverse", placesController.reversePlace);

export { PlacesRouter };
