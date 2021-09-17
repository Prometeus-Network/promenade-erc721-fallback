FROM node:14-alpine
WORKDIR /app
ENV PATH /app/node_modules/.bin:$PATH
COPY package*.json yarn.lock /app/
COPY . /app
RUN yarn --frozen-lockfile
CMD yarn start