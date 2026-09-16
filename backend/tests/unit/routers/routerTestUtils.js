import fs from 'fs';
import path from 'path';

const requestsRoot = path.resolve(__dirname, '../../../src/requests');

const namedHandler = name => {
  const handler = jest.fn((_req, _res, next) => next?.());

  Object.defineProperty(handler, 'contractName', { value: name });
  return handler;
};

const createControllerNamespace = namespace =>
  new Proxy(
    {},
    {
      get(target, property) {
        if (!target[property]) {
          Reflect.set(target, property, namedHandler(`${namespace}.${String(property)}`));
        }

        return target[property];
      },
    },
  );

const controllerNames = ['authController', 'generalController', 'travelRuleController'];

const listRequestModules = (directory = requestsRoot) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return listRequestModules(absolutePath);
    }

    if (!entry.name.endsWith('.js')) {
      return [];
    }

    return [absolutePath];
  });

const joinPaths = (prefix, suffix) => {
  const joined = `${prefix}/${suffix}`.replace(/\/+/g, '/');

  return joined.length > 1 && joined.endsWith('/') ? joined.slice(0, -1) : joined;
};

const handlerName = handler => handler.contractName || handler.name || '<anonymous>';

const inspectRouter = router => {
  const routes = [];
  const mounts = [];

  const visit = (currentRouter, prefix = '') => {
    const stack = currentRouter.stack || [];
    const processedMounts = new Set();

    stack.forEach(layer => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods).filter(method => layer.route.methods[method]);
        const handlers = layer.route.stack.map(routeLayer => handlerName(routeLayer.handle)).join(' > ');

        methods.forEach(method => routes.push(`${method.toUpperCase()} ${joinPaths(prefix, layer.route.path)} :: ${handlers}`));
        return;
      }

      if (!layer.contractMountId || processedMounts.has(layer.contractMountId)) {
        return;
      }

      processedMounts.add(layer.contractMountId);
      const mountedLayers = stack.filter(candidate => candidate.contractMountId === layer.contractMountId);
      const mountPath = joinPaths(prefix, layer.contractMountPath);
      const handlers = mountedLayers.map(mountedLayer => (mountedLayer.handle?.stack ? '<router>' : handlerName(mountedLayer.handle)));

      mounts.push(`USE ${mountPath} :: ${handlers.join(' > ')}`);
      mountedLayers.filter(mountedLayer => mountedLayer.handle?.stack).forEach(mountedLayer => visit(mountedLayer.handle, mountPath));
    });
  };

  visit(router);
  return { mounts, routes };
};

const loadRouter = moduleName => {
  jest.resetModules();

  const controllers = Object.fromEntries(controllerNames.map(name => [name, createControllerNamespace(name)]));
  let rateLimiterCount = 0;
  let mountCount = 0;

  jest.doMock(path.resolve(__dirname, '../../../src/controllers'), () => controllers);
  jest.doMock('express-rate-limit', () => ({
    __esModule: true,
    default: jest.fn(() => {
      rateLimiterCount += 1;
      return namedHandler(`rateLimit:${rateLimiterCount}`);
    }),
  }));
  jest.doMock('express', () => {
    const actualExpress = jest.requireActual('express');

    return {
      ...actualExpress,
      Router: (...args) => {
        const router = actualExpress.Router(...args);
        const originalUse = router.use.bind(router);

        router.use = (...useArgs) => {
          const start = router.stack.length;
          const mountPath = typeof useArgs[0] === 'string' ? useArgs[0] : '/';
          const result = originalUse(...useArgs);
          const mountId = `mount:${(mountCount += 1)}`;

          router.stack.slice(start).forEach(layer => {
            Object.defineProperties(layer, {
              contractMountId: { value: mountId },
              contractMountPath: { value: mountPath },
            });
          });

          return result;
        };

        return router;
      },
    };
  });

  listRequestModules().forEach(requestModule => {
    const contractName = `@requests/${path.relative(requestsRoot, requestModule).replaceAll(path.sep, '/').replace(/\.js$/, '')}`;

    jest.doMock(requestModule, () => ({ __esModule: true, default: namedHandler(contractName) }));
  });

  let loaded;
  jest.isolateModules(() => {
    loaded = jest.requireActual(path.resolve(__dirname, `../../../src/routers/${moduleName}`)).default;
  });

  return loaded;
};

const expectRouterContract = (moduleName, expected) => {
  const router = loadRouter(moduleName);

  expect(typeof router).toBe('function');
  expect(inspectRouter(router)).toEqual(expected);
};

export { expectRouterContract, inspectRouter, loadRouter };
