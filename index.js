const path = require("path");
const glob = require("glob");
const replaceAsync = require("string-replace-async");
const loaderUtils = require("loader-utils");
const enhancedResolver = require("enhanced-resolve");
require("array-flat-polyfill");

module.exports = async function (source) {
  this.cacheable && this.cacheable(true);

  const callback = this.async();
  const regex = /import + ?((\w+) +from )?([\'\"])(.*?);?\3/gm;
  const importModules = /import +(\w+) +from +([\'\"])(.*?)\2/gm;
  const importFiles = /import +([\'\"])(.*?)\1/gm;

  const sassRegex = /@(import|use|forward) +( ?([\'\"])(.*?)\2 *,?)(?: +as +(.*?))?(?: +hide +((?:.*?),)?)? *;/gm;

  const importSass = /@import +([\'\"])(.*?)\1/gm;
  const useSass = /@use +([\'\"])(.*?)\1/gm;
  const forwardSass = /@forward +([\'\"])(.*?)\1/gm;

  const options = Object.assign({}, loaderUtils.getOptions(this));
  const basePath = path.dirname(this.resourcePath);
  const resolvePaths = (pathToResolve) => {
    return new Promise((resolve, reject) => {
      const tempMissing = [];
      const resolverContext = {
        missingDependencies: {
          add(path) {
            tempMissing.push(path);
          },
        },
      };

      enhancedResolver.create(options.resolve || {})(
        this,
        basePath,
        pathToResolve,
        resolverContext,
        (err, result) => {
          if (err && !result) {
            const missing = [...new Set(tempMissing)].filter(glob.hasMagic);

            if (Array.isArray(missing)) {
              let filteredMissing = missing.map((M) => glob.sync(M)).flat();

              if (!filteredMissing.length) {
                filteredMissing = glob.sync(
                  path.resolve(basePath, pathToResolve)
                );

                if (!filteredMissing.length) {
                  this.emitWarning(
                    "Could not find any files that matched the wildcard path."
                  );
                }
              }

              return resolve(filteredMissing);
            } else {
              return reject("Could not resolve the wildcard path.");
            }

            resolve([result]);
          }
        }
      );
    });
  };

  try {
    // Do JS Imports
    let updatedSource = await replaceAsync(
      source,
      regex,
      async (match, fromStatement, obj, quote, filename) => {
        // If there are no wildcards, return early
        if (!glob.hasMagic(filename)) {
          return match;
        }

        const paths = [];
        const globRelativePath = filename.match(/!?([^!]*)$/)[1];
        const prefix = filename.replace(globRelativePath, "");

        let result = (await resolvePaths(globRelativePath))
          .map((file, index) => {
            const fileName = quote + prefix + file + quote;
            let importString;
            let moduleName;

            if (match.match(importModules)) {
              moduleName = obj + index;
              importString = `import * as ${moduleName} from ${fileName};`;
            } else if (match.match(importFiles)) {
              importString = `import ${fileName};`;
            } else {
              this.emitWarning('Unknown import: "' + match + '"');
            }

            paths.push({ path: fileName, module: moduleName, importString });

            return importString;
          })
          .join(" ");

        if (result && paths.length && typeof options.banner === "function") {
          result += options.banner(paths, obj) || "";
        } else if (!result) {
          this.emitWarning('Empty results for "' + match + '"');
        }

        return result.slice(0, -1);
      }
    );

    // Do Sass imports
    updatedSource = await replaceAsync(
      updatedSource,
      sassRegex,
      async (match, atrule, filesStr, quote, p4, prefix, ...rest) => {
        const fileNames = filesStr
          .split(",")
          .map((file) => file.trim().slice(1, -1));

        // If there are no wildcards, return early
        if (!fileNames.some((fileName) => glob.hasMagic(filename))) {
          return match;
        }

        console.log({ atrule, fileNames, quote, p4, prefix, rest });

        switch (atrule) {
          case "import":
            break;
          case "use":
            break;
          case "forward":
            break;
        }

        // @import 'foundation';
        // @import 'foundation/asdasd.scss';
        // @import '_foundation';
        // @import 'code', 'lists';

        // @use 'foundation/code';
        // @use "src/corners", '_bob' as *;
        // @use "src/corners" as *;
        // @use "src/corners" as c;

        // @forward "src/list";
        // @forward "src/list" as list-*;
        // @forward "src/list" as c hide list-reset, $horizontal-list-gap;
        // @forward "src/list" hide list-reset, $horizontal-list-gap;

        return match;
      }
    );

    callback(null, updatedSource);
  } catch (err) {
    callback(err);
  }
};
