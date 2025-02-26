document.addEventListener('DOMContentLoaded', function() {
    // Monthly Trends Chart
    const monthlyTrendsCtx = document.getElementById('monthlyTrendsChart').getContext('2d');
    const monthlyTrendsChart = new Chart(monthlyTrendsCtx, {
      type: 'bar',
      data: {
        labels: Array.from(document.querySelectorAll('[data-month]')).map(el => el.dataset.month),
        datasets: [
          {
            label: 'Total Hours',
            data: Array.from(document.querySelectorAll('[data-hours]')).map(el => el.dataset.hours),
            backgroundColor: 'rgba(192, 31, 40, 0.7)',
            borderColor: 'rgba(192, 31, 40, 1)',
            borderWidth: 1
          },
          {
            label: 'Request Count',
            data: Array.from(document.querySelectorAll('[data-requests]')).map(el => el.dataset.requests),
            backgroundColor: 'rgba(23, 162, 184, 0.7)',
            borderColor: 'rgba(23, 162, 184, 1)',
            borderWidth: 1,
            yAxisID: 'count'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Total Hours'
            }
          },
          count: {
            position: 'right',
            beginAtZero: true,
            title: {
              display: true,
              text: 'Request Count'
            },
            grid: {
              drawOnChartArea: false
            }
          },
          x: {
            title: {
              display: true,
              text: 'Month'
            }
          }
        }
      }
    });
    
    // Site Statistics Chart
    const siteStatsCtx = document.getElementById('siteStatsChart').getContext('2d');
    const siteStatsChart = new Chart(siteStatsCtx, {
      type: 'pie',
      data: {
        labels: Array.from(document.querySelectorAll('[data-site]')).slice(0, 5).map(el => el.dataset.site),
        datasets: [{
          data: Array.from(document.querySelectorAll('[data-site-hours]')).slice(0, 5).map(el => el.dataset.siteHours),
          backgroundColor: [
            'rgba(192, 31, 40, 0.7)',
            'rgba(23, 162, 184, 0.7)',
            'rgba(40, 167, 69, 0.7)',
            'rgba(255, 193, 7, 0.7)',
            'rgba(111, 66, 193, 0.7)'
          ],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: {
            display: true,
            text: 'Top 5 Sites by Hours',
            font: {
              size: 16
            }
          },
          legend: {
            position: 'right'
          }
        }
      }
    });
    
    // Add active class to current navigation item
    const currentLocation = location.pathname;
    const navItems = document.querySelectorAll('.nav-link');
    navItems.forEach(item => {
      if(item.getAttribute('href') === currentLocation) {
        item.classList.add('active');
      }
    });
    
    // Export users button
    const exportUsersBtn = document.getElementById('exportUsersBtn');
    if (exportUsersBtn) {
      exportUsersBtn.addEventListener('click', function(e) {
        e.preventDefault();
        window.location.href = this.getAttribute('href');
      });
    }
    
    // Handle modals for viewing user details
    const viewButtons = document.querySelectorAll('.view-btn');
    viewButtons.forEach(button => {
      button.addEventListener('click', function() {
        const modalId = this.getAttribute('data-bs-target');
        const modal = new bootstrap.Modal(document.querySelector(modalId));
        modal.show();
      });
    });
  });