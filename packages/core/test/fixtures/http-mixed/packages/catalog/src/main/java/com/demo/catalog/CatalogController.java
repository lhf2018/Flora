package com.demo.catalog;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/catalog")
public class CatalogController {
  @GetMapping
  public String list() {
    return "[]";
  }

  @GetMapping("/{id}")
  public String one() {
    return "{}";
  }
}
