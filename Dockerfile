FROM nginx:alpine
COPY . /usr/share/nginx/html
COPY nginx/nginx.conf /etc/nginx/nginx.conf