# NodeJs<br />
mem-redis-mysql复合缓存<br />
mem-redis-mysql cache module for nodejs<br />

依赖lib：config,direct_solid,log4js

使用说明请见sample.js

1.0.4 优化缓存更新机制：
使用预加载的形式，过期时先预返回内存数据，然后异步清除和加载最新数据，对于用户来说，永远是快速的返回内存数据