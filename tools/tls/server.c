/* Memory BIO adapter. Networking and cryptographic entropy belong to the host. */
#include <stdlib.h>
#include <string.h>
#include "mbedtls/ssl.h"
#include "mbedtls/x509_crt.h"
#include "mbedtls/pk.h"
#include "mbedtls/platform_util.h"

__attribute__((import_module("sart"), import_name("random")))
extern int host_random(unsigned char *, size_t);
static int rng(void *unused, unsigned char *p, size_t n) { (void)unused; return host_random(p,n); }
#define CAP 65536
#define SLOTS 8
typedef struct { mbedtls_ssl_context ssl; unsigned char in[CAP],out[CAP]; size_t ni,no; int used,ready; } client;
static client *slots[SLOTS];
static mbedtls_ssl_config conf;
static mbedtls_x509_crt cert;
static mbedtls_pk_context key;
static int initialized;
static const char *alpn[]={"http/1.1",NULL};
static client *get(int id) {return id>=0&&id<SLOTS ? slots[id] : NULL;}
static int bio_send(void *ctx,const unsigned char *p,size_t n) {
 client *c=ctx; if(n>CAP-c->no)return MBEDTLS_ERR_SSL_WANT_WRITE;
 memcpy(c->out+c->no,p,n);c->no+=n;return (int)n;
}
static int bio_recv(void *ctx,unsigned char *p,size_t n) {
 client *c=ctx;if(!c->ni)return MBEDTLS_ERR_SSL_WANT_READ;
 if(n>c->ni)n=c->ni;memcpy(p,c->in,n);c->ni-=n;memmove(c->in,c->in+n,c->ni);return (int)n;
}
void sart_close(int id) {
 client *c=get(id);if(!c)return;mbedtls_ssl_free(&c->ssl);mbedtls_platform_zeroize(c,sizeof(*c));free(c);slots[id]=NULL;
}
void sart_destroy(void) {
 for(int i=0;i<SLOTS;i++)sart_close(i);
 if(initialized){mbedtls_ssl_config_free(&conf);mbedtls_x509_crt_free(&cert);mbedtls_pk_free(&key);initialized=0;}
}
int sart_init(const unsigned char *crt,size_t cn,const unsigned char *priv,size_t pn) {
 sart_destroy();mbedtls_ssl_config_init(&conf);mbedtls_x509_crt_init(&cert);mbedtls_pk_init(&key);initialized=1;
 int r=mbedtls_x509_crt_parse_der(&cert,crt,cn);if(r)return r;
 r=mbedtls_pk_parse_key(&key,priv,pn,NULL,0,rng,NULL);if(r)return r;
 r=mbedtls_pk_check_pair(&cert.pk,&key,rng,NULL);if(r)return r;
 r=mbedtls_ssl_config_defaults(&conf,MBEDTLS_SSL_IS_SERVER,MBEDTLS_SSL_TRANSPORT_STREAM,MBEDTLS_SSL_PRESET_DEFAULT);if(r)return r;
 mbedtls_ssl_conf_rng(&conf,rng,NULL);
 mbedtls_ssl_conf_authmode(&conf,MBEDTLS_SSL_VERIFY_NONE); /* Application pairing authorises the client. */
 mbedtls_ssl_conf_min_tls_version(&conf,MBEDTLS_SSL_VERSION_TLS1_2);
 mbedtls_ssl_conf_max_tls_version(&conf,MBEDTLS_SSL_VERSION_TLS1_2);
 r=mbedtls_ssl_conf_alpn_protocols(&conf,alpn);if(r)return r;
 return mbedtls_ssl_conf_own_cert(&conf,&cert,&key);
}
int sart_open(void) {
 for(int i=0;i<SLOTS;i++)if(!slots[i]){
  client *c=calloc(1,sizeof(*c));if(!c)return -1;mbedtls_ssl_init(&c->ssl);
  if(mbedtls_ssl_setup(&c->ssl,&conf)){free(c);return -1;}
  mbedtls_ssl_set_bio(&c->ssl,c,bio_send,bio_recv,NULL);c->used=1;slots[i]=c;return i;
 }return -1;
}
int sart_feed(int id,const unsigned char *p,size_t n) {client *c=get(id);if(!c||n>CAP-c->ni)return -1;memcpy(c->in+c->ni,p,n);c->ni+=n;return 0;}
int sart_drain(int id,unsigned char *p,size_t n) {client *c=get(id);if(!c)return -1;if(n>c->no)n=c->no;memcpy(p,c->out,n);c->no-=n;memmove(c->out,c->out+n,c->no);return (int)n;}
int sart_handshake(int id) {client *c=get(id);if(!c)return -1;if(c->ready)return 0;int r=mbedtls_ssl_handshake(&c->ssl);if(!r)c->ready=1;return r==MBEDTLS_ERR_SSL_WANT_READ||r==MBEDTLS_ERR_SSL_WANT_WRITE?1:r;}
int sart_read(int id,unsigned char *p,size_t n) {client *c=get(id);if(!c)return -1;int r=mbedtls_ssl_read(&c->ssl,p,n);return r==MBEDTLS_ERR_SSL_WANT_READ||r==MBEDTLS_ERR_SSL_WANT_WRITE?-2:r;}
int sart_write(int id,const unsigned char *p,size_t n) {client *c=get(id);if(!c)return -1;int r=mbedtls_ssl_write(&c->ssl,p,n);return r==MBEDTLS_ERR_SSL_WANT_READ||r==MBEDTLS_ERR_SSL_WANT_WRITE?-2:r;}
int sart_notify(int id) {client *c=get(id);if(!c)return -1;return mbedtls_ssl_close_notify(&c->ssl);}
