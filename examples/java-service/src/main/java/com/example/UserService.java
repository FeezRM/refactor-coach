package com.example;

import java.time.Clock;
import java.util.List;
import org.springframework.web.client.RestTemplate;

public class UserService {
  public int scoreUser(User user, List<String> roles, Request request, Audit audit, Flags flags, Clock clock) {
    if (user == null) {
      return 0;
    }
    if (roles.contains("admin")) {
      return 100;
    }
    if (request.path().contains("/beta")) {
      if (flags.beta()) {
        return 80;
      }
      return 40;
    }
    if (audit.required()) {
      if (audit.passed()) {
        return 50;
      }
      return 0;
    }
    return new RestTemplate().getForObject("https://example.com", Integer.class);
  }
}
