// Preloaded only for the DOM test run (`bun run test:dom`), never for the
// default suite. Registering happy-dom defines `window`/`document` globally,
// and server-side modules branch on `typeof window` at import time — pulling
// this into the main run flips those branches and breaks route tests. Hence
// the separate run and the `*.dom.test.tsx` ignore pattern in bunfig.toml.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import "./testSetupEnv";

GlobalRegistrator.register();

// React 19 requires this flag before `act` will drive updates.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
