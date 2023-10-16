import * as FileSaver from 'file-saver';
import { cloneDeep, concat, each, find, has, set } from 'lodash';
import _semver from 'semver';
import { default as _yaml } from 'yaml';
import * as _yup from 'yup';

const dummyInfo = {
  oa__title: 'test',
  // "oa__summary": "test summary",
  oa__description: 'test description',
  oa__termsOfService: 'http://google.com',
  oa__contact__name: 'test contact name',
  oa__contact__url: 'http://google.com',
  oa__contact__email: 'john.doe@example.com',
  oa__license__name: 'test license name',
  // "oa__license__identifier": "test license identifier",
  oa__license__url: 'http://google.com',
  oa__externalDocs__description: 'test external docs',
  oa__externalDocs__url: 'http://google.com',
  oa__version: '1.0.0',
  base_url: 'http://google.com',
  id: 10
};

const transformKeyValueToObject = (object) => {
  let objPath = '',
    objValue,
    i,
    key,
    path,
    value;
  const accumulator = {};
  const data = cloneDeep(object);

  for ([key, value] of Object.entries(data)) {
    path = key.split('__');
    for (i = 0; i < path.length; i++) {
      objValue = {};
      if (i !== 0) {
        objPath += '.';
      }
      if (i + 1 === path.length) {
        objValue = value;
      }
      objPath += path[i];

      if (!has(accumulator, objPath)) {
        set(accumulator, objPath, objValue);
      }
    }
    objPath = '';
  }

  return accumulator;
};

const saveOpenApiAsFile = (name, openApi) => {
  const fileName = `${name}.yml`;
  const fileBlob = new Blob([_yaml.stringify(openApi)], { type: 'text/x-yaml' });

  FileSaver.saveAs(fileBlob, fileName);
};

const validateOpenApiInfoSection = (info = {}) => {
  _yup.addMethod(_yup.string, 'semver', function semver() {
    return this.transform(function (value) {
      return _semver.valid(value) !== null ? value : null;
    });
  });

  const schema = _yup.object({
    title: _yup.string().required(),
    // summary: _yup.string().default(null),
    description: _yup.string().default(null),
    termsOfService: _yup.string().url().default(null),
    contact: _yup.object({
      name: _yup.string().default(null),
      url: _yup.string().url().default(null),
      email: _yup.string().email().default(null)
    }),
    license: _yup.object({
      name: _yup.string().required().default(null),
      // identifier: _yup.string().default(null),
      url: _yup.string().url().default(null)
    }),
    externalDocs: _yup.object({
      description: _yup.string().default(null),
      url: _yup.string().url().default(null)
    }),
    version: _yup.string().semver()
  });

  return schema.validateSync(info);
};

const validateOpenApiServer = (server) => {
  const url = _yup.string().required().url();

  try {
    url.validateSync(server);
    return true;
  } catch (e) {
    return false;
  }
};

const validateOpenApiRequest = (items = [], paths = {}, tags = []) => {
  // type http-request, graphql-request, folder
  let tag;

  each(items, (data) => {
    if (data.type === 'folder') {
      validateOpenApiRequest(data.items, paths, tags);
    } else {
      tag = fillOpenApiTag(data.pathname, data.depth, tags);
      fillOpenApiPath(data.type, tag, data.name, data.request, paths);
    }
  });
};

const fillOpenApiTag = (fullPath, depth, tags = []) => {
  const paths = fullPath.split('\\');
  const tag = paths.slice(paths.length - depth, -1).join(' -> ');
  const isTagExist = find(tags, (v) => v.name === tag);
  if (tag && !isTagExist) {
    tags.push({ name: tag });
  }
  return tag;
};

const fillOpenApiPath = (type, tag, name, request = {}, paths = {}) => {
  const metadata = {
    tags: [tag],
    summary: name
  };

  let url = request.url;
  if (request.url.search(/{{base_url}}/gim) > -1) {
    url = request.url.replace(/{{base_url}}/gim, 'http://example.com');
  }
  url = new URL(url);
  const { path, parameters: pathParameter } = pluckPathAndParameterFromURL(url.pathname);

  if (!has(paths, path)) {
    set(paths, path, {});
  }

  const query = pluckQueryParameterFromRequest(request.params);

  const parameters = concat(pathParameter, query);

  if (parameters.length) {
    metadata.parameters = parameters;
  }

  set(paths[path], request.method.toLowerCase(), metadata);

  // console.log(request, query, pathParameter, path);
};

const pluckPathAndParameterFromURL = (pathname) => {
  const parameters = [];
  const regexRule = /({{2})|(}{2})|(:{1})/gim;
  let path = pathname.split('/');

  path = path.reduce((acc, value) => {
    if (value) {
      value = decodeURIComponent(value);
      if (value.search(regexRule) > -1) {
        value = value.replace(regexRule, '');
        parameters.push({
          name: value,
          in: 'path',
          schema: {
            type: 'string'
          },
          required: true
        });
        value = `{${value}}`;
      }
      acc += `/${value}`;
    }
    return acc;
  }, '');

  return { path, parameters };
};

const pluckQueryParameterFromRequest = (params) => {
  return params.reduce((acc, param) => {
    if (param.enabled) {
      acc.push({
        name: param.name,
        in: 'query',
        schema: {
          type: 'string'
        },
        required: false
      });
    }
    return acc;
  }, []);
};

export default function (collection, options = {}) {
  console.log(collection);

  const openApiFormat = {
    paths: {},
    servers: [],
    tags: []
  };
  const { base_url, oa } = transformKeyValueToObject(dummyInfo);
  // const { base_url, oa } = transformKeyValueToObject(collection.collectionVariables);

  // set OpenAPI version
  openApiFormat.openapi = '3.0.3';

  // @TODO throw error not find metadata
  if (!oa) {
    return;
  }

  // set OpenAPI metadata info and externalDocs
  try {
    const { externalDocs, ...openApiInfo } = validateOpenApiInfoSection(oa);
    openApiFormat.info = openApiInfo;
    if (externalDocs) {
      openApiFormat.externalDocs = externalDocs;
    }
  } catch (e) {
    //TODO return friendly format error
    console.log(e);
    return e;
  }

  // set OpenAPI server from collection level env
  if (base_url && validateOpenApiServer(base_url)) {
    openApiFormat.servers.push({
      url: base_url,
      description: 'Default'
    });
  }

  // set OpenAPI server from environment level
  each(collection.environments, (environment) => {
    const envBaseUrl = find(environment.variables, (env) => env.name === 'base_url');
    if (envBaseUrl && validateOpenApiServer(envBaseUrl.value)) {
      openApiFormat.servers.push({
        url: envBaseUrl.value,
        description: environment.name
      });
    }
  });

  // set OpenAPI request from collection item
  validateOpenApiRequest(collection.items, openApiFormat.paths, openApiFormat.tags);

  console.log(openApiFormat);

  return saveOpenApiAsFile(collection.name, openApiFormat);
}
